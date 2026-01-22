import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { readAsURL, write, delete as deleteFile } from "../src/index.js";

type OpfsDirectory = {
  directories: Map<string, OpfsDirectory>;
  files: Map<string, Uint8Array>;
};

type MockDirectoryHandle = {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<MockDirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    getFile: () => Promise<Blob>;
    createWritable: () => Promise<{
      write: (data: unknown) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
  removeEntry: (name: string) => Promise<void>;
};

type NavigatorWithStorage = {
  storage: {
    getDirectory: () => Promise<MockDirectoryHandle>;
  };
};

let originalCwd = "";
let tempDir = "";
let originalNavigatorDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(join(tmpdir(), "uni-fs-"));
  process.chdir(tempDir);
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
});

afterEach(async () => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete (globalThis as { navigator?: unknown }).navigator;
  }
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

function createOpfsRoot(): { root: MockDirectoryHandle; state: OpfsDirectory } {
  const state: OpfsDirectory = {
    directories: new Map(),
    files: new Map()
  };

  const getDirectoryHandle = async (
    current: OpfsDirectory,
    name: string,
    options?: { create?: boolean }
  ): Promise<OpfsDirectory> => {
    const existing = current.directories.get(name);
    if (existing) {
      return existing;
    }
    if (!options?.create) {
      throw new Error("NotFoundError");
    }
    const next: OpfsDirectory = { directories: new Map(), files: new Map() };
    current.directories.set(name, next);
    return next;
  };

  const getFileHandle = async (
    current: OpfsDirectory,
    name: string,
    options?: { create?: boolean }
  ): Promise<OpfsDirectory> => {
    if (!current.files.has(name) && !options?.create) {
      throw new Error("NotFoundError");
    }
    if (!current.files.has(name)) {
      current.files.set(name, new Uint8Array());
    }
    return current;
  };

  const makeHandle = (current: OpfsDirectory): MockDirectoryHandle => {
    return {
      getDirectoryHandle: async (name, options) => {
        const next = await getDirectoryHandle(current, name, options);
        return makeHandle(next);
      },
      getFileHandle: async (name, options) => {
        const target = await getFileHandle(current, name, options);
        return {
          getFile: async () => {
            const bytes = target.files.get(name) ?? new Uint8Array();
            return new Blob([bytes]);
          },
          createWritable: async () => {
            return {
              write: async (data: unknown) => {
                if (typeof data === "string") {
                  target.files.set(name, new TextEncoder().encode(data));
                  return;
                }
                if (data instanceof ArrayBuffer) {
                  target.files.set(name, new Uint8Array(data));
                  return;
                }
                if (data instanceof Blob) {
                  target.files.set(name, new Uint8Array(await data.arrayBuffer()));
                  return;
                }
                if (ArrayBuffer.isView(data)) {
                  target.files.set(name, new Uint8Array(data.buffer));
                  return;
                }
                throw new Error("Unsupported data type.");
              },
              close: async () => {}
            };
          }
        };
      },
      removeEntry: async (name) => {
        if (current.files.has(name)) {
          current.files.delete(name);
          return;
        }
        if (current.directories.has(name)) {
          current.directories.delete(name);
          return;
        }
        throw new Error("NotFoundError");
      }
    };
  };

  return { root: makeHandle(state), state };
}

function installOpfsNavigator(root: MockDirectoryHandle): void {
  const mockNavigator: NavigatorWithStorage = {
    storage: {
      getDirectory: async () => root
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: mockNavigator
  });
}

test("node: write() persists data and readAsURL() returns a path", async () => {
  await write("snapshots/page", "txt", "hello");
  const contents = await readFile(join(tempDir, "snapshots", "page.txt"), "utf8");
  assert.equal(contents, "hello");

  const url = await readAsURL("snapshots/page", "txt");
  assert.equal(url, "/snapshots/page.txt");
});

test("node: write() accepts Uint8Array and delete() removes the file", async () => {
  await write("assets/logo", "bin", new Uint8Array([1, 2, 3]));
  const beforeDelete = await readFile(join(tempDir, "assets", "logo.bin"));
  assert.deepEqual(new Uint8Array(beforeDelete), new Uint8Array([1, 2, 3]));

  await deleteFile("assets/logo", "bin");
  await assert.rejects(async () => {
    await access(join(tempDir, "assets", "logo.bin"));
  });
});

test("browser: write/read/delete uses OPFS and returns data URL", async () => {
  const { root } = createOpfsRoot();
  installOpfsNavigator(root);

  await write("images/logo", "png", new Uint8Array([137, 80, 78, 71]));
  const url = await readAsURL("images/logo", "png");
  const expectedBase64 = Buffer.from([137, 80, 78, 71]).toString("base64");
  assert.equal(url, `data:image/png;base64,${expectedBase64}`);

  await deleteFile("images/logo", "png");
  await assert.rejects(async () => {
    await readAsURL("images/logo", "png");
  });
});

test("service worker: write/read/delete supports Blob writes", async () => {
  const { root } = createOpfsRoot();
  installOpfsNavigator(root);

  await write("cache/entry", "txt", new Blob(["ok"]));
  const url = await readAsURL("cache/entry", "txt");
  const expectedBase64 = Buffer.from("ok").toString("base64");
  assert.equal(url, `data:text/plain;base64,${expectedBase64}`);

  await deleteFile("cache/entry", "txt");
  await assert.rejects(async () => {
    await readAsURL("cache/entry", "txt");
  });
});
