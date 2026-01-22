export type WriteData = ArrayBuffer | Uint8Array | Blob | string;

type ProcessLike = {
  cwd?: () => string;
  versions?: {
    node?: string;
  };
};

type GlobalWithProcess = {
  process?: ProcessLike;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  css: "text/css",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp"
};

const OPFS_ERROR_MESSAGE =
  "OPFS is not available in this environment. Use a browser or service worker that supports navigator.storage.getDirectory().";

function normalizeExtension(extension: string): string {
  if (!extension) {
    return "";
  }
  return extension.startsWith(".") ? extension.slice(1) : extension;
}

function buildFileName(filename: string, extension: string): string {
  const normalizedExtension = normalizeExtension(extension);
  if (!normalizedExtension) {
    return filename;
  }
  return `${filename}.${normalizedExtension}`;
}

function isOpfsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function isNodeEnvironment(): boolean {
  const globalProcess = (globalThis as GlobalWithProcess).process;
  return typeof globalProcess?.versions?.node === "string";
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsAvailable()) {
    throw new Error(OPFS_ERROR_MESSAGE);
  }
  return navigator.storage.getDirectory();
}

async function getOpfsDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
  options: { create: boolean }
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, {
      create: options.create
    });
  }
  return current;
}

function splitPath(path: string): { directories: string[]; basename: string } {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { directories: [], basename: path };
  }
  const basename = parts[parts.length - 1] ?? "";
  const directories = parts.slice(0, -1);
  return { directories, basename };
}

function guessMimeType(extension: string): string {
  const normalizedExtension = normalizeExtension(extension).toLowerCase();
  return MIME_BY_EXTENSION[normalizedExtension] ?? "application/octet-stream";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bufferConstructor = (
    globalThis as {
      Buffer?: {
        from(data: ArrayBuffer): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return bufferConstructor.from(buffer).toString("base64");
  }
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function dataToOpfsWritable(data: WriteData): Promise<FileSystemWriteChunkType> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data).buffer;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data;
  }
  throw new Error("Unsupported data type.");
}

async function dataToNodeWritable(data: WriteData): Promise<string | Uint8Array> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("Unsupported data type.");
}

function getNodeCwd(): string {
  const nodeProcess = (globalThis as GlobalWithProcess).process;
  if (!nodeProcess?.cwd) {
    throw new Error("process.cwd is unavailable in this environment.");
  }
  return nodeProcess.cwd();
}

export async function exists(filename: string, extension: string): Promise<boolean> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { directories, basename } = splitPath(fileName);
      const directory = await getOpfsDirectory(root, directories, {
        create: false
      });
      await directory.getFileHandle(basename, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  if (isNodeEnvironment()) {
    const { join } = await import("node:path");
    const { access } = await import("node:fs/promises");
    const outputPath = join(getNodeCwd(), fileName);
    try {
      await access(outputPath);
      return true;
    } catch {
      return false;
    }
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export async function readBinary(filename: string, extension: string): Promise<Uint8Array> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    const root = await getOpfsRoot();
    const { directories, basename } = splitPath(fileName);
    const directory = await getOpfsDirectory(root, directories, {
      create: false
    });
    const fileHandle = await directory.getFileHandle(basename);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (isNodeEnvironment()) {
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");
    const outputPath = join(getNodeCwd(), fileName);
    const buffer = await readFile(outputPath);
    return new Uint8Array(buffer);
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export async function readText(filename: string, extension: string): Promise<string> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    const root = await getOpfsRoot();
    const { directories, basename } = splitPath(fileName);
    const directory = await getOpfsDirectory(root, directories, {
      create: false
    });
    const fileHandle = await directory.getFileHandle(basename);
    const file = await fileHandle.getFile();
    return file.text();
  }

  if (isNodeEnvironment()) {
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");
    const outputPath = join(getNodeCwd(), fileName);
    return readFile(outputPath, "utf-8");
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export async function readAsURL(filename: string, extension: string): Promise<string> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    const root = await getOpfsRoot();
    const { directories, basename } = splitPath(fileName);
    const directory = await getOpfsDirectory(root, directories, {
      create: false
    });
    const fileHandle = await directory.getFileHandle(basename);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    const mimeType = file.type || guessMimeType(extension);
    const base64 = arrayBufferToBase64(buffer);
    return `data:${mimeType};base64,${base64}`;
  }

  if (isNodeEnvironment()) {
    return `/${fileName}`;
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export async function write(filename: string, extension: string, data: WriteData): Promise<void> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    const root = await getOpfsRoot();
    const { directories, basename } = splitPath(fileName);
    const directory = await getOpfsDirectory(root, directories, {
      create: true
    });
    const fileHandle = await directory.getFileHandle(basename, {
      create: true
    });
    const writable = await fileHandle.createWritable();
    const writableData = await dataToOpfsWritable(data);
    await writable.write(writableData);
    await writable.close();
    return;
  }

  if (isNodeEnvironment()) {
    const { dirname, join } = await import("node:path");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const outputPath = join(getNodeCwd(), fileName);
    await mkdir(dirname(outputPath), { recursive: true });
    const writableData = await dataToNodeWritable(data);
    await writeFile(outputPath, writableData);
    return;
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export async function remove(filename: string, extension: string): Promise<void> {
  const fileName = buildFileName(filename, extension);

  if (isOpfsAvailable()) {
    const root = await getOpfsRoot();
    const { directories, basename } = splitPath(fileName);
    const directory = await getOpfsDirectory(root, directories, {
      create: false
    });
    await directory.removeEntry(basename);
    return;
  }

  if (isNodeEnvironment()) {
    const { join } = await import("node:path");
    const { unlink } = await import("node:fs/promises");
    const outputPath = join(getNodeCwd(), fileName);
    await unlink(outputPath);
    return;
  }

  throw new Error(OPFS_ERROR_MESSAGE);
}

export { remove as delete };
