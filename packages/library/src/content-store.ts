import { readBinary, remove, write } from "@pagepocket/uni-fs";

import type { BodySource, ContentRef, ContentStore } from "./types";
import { hashString, toUint8Array } from "./utils";

type HybridContentStoreOptions = {
  thresholdBytes?: number;
  baseDir?: string;
};

const DEFAULT_THRESHOLD = 256 * 1024;
const DEFAULT_BASE_DIR = ".pagepocket_store";

const nowId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const streamFromBytes = (data: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    }
  });

const isNodeEnvironment = () => {
  const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof globalProcess?.versions?.node === "string";
};

export class HybridContentStore implements ContentStore {
  name = "hybrid";
  private thresholdBytes: number;
  private baseDir: string;
  private storedIds = new Set<string>();

  constructor(options?: HybridContentStoreOptions) {
    this.thresholdBytes = options?.thresholdBytes ?? DEFAULT_THRESHOLD;
    this.baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
  }

  async put(
    body: BodySource,
    meta: { url: string; mimeType?: string; sizeHint?: number }
  ): Promise<ContentRef> {
    const data = await toUint8Array(body);
    const size = data.byteLength;
    if (size <= this.thresholdBytes) {
      return { kind: "memory", data };
    }
    const id = `${hashString(meta.url)}_${nowId()}`;
    await write(`${this.baseDir}/${id}`, "bin", data);
    this.storedIds.add(id);
    return { kind: "store-ref", id };
  }

  async open(ref: ContentRef): Promise<ReadableStream<Uint8Array>> {
    if (ref.kind === "memory") {
      return streamFromBytes(ref.data);
    }
    const data = await readBinary(`${this.baseDir}/${ref.id}`, "bin");
    return streamFromBytes(data);
  }

  async dispose(): Promise<void> {
    const entries = Array.from(this.storedIds);
    this.storedIds.clear();
    await Promise.all(entries.map((id) => remove(`${this.baseDir}/${id}`, "bin").catch(() => {})));
    await this.removeBaseDir().catch(() => {});
  }

  private async removeBaseDir(): Promise<void> {
    if (!isNodeEnvironment()) {
      return;
    }
    if (!this.baseDir || this.baseDir === "/" || this.baseDir === ".") {
      return;
    }
    const { resolve, isAbsolute } = await import("node:path");
    const { rm } = await import("node:fs/promises");
    const target = isAbsolute(this.baseDir) ? this.baseDir : resolve(this.baseDir);
    await rm(target, { recursive: true, force: true });
  }
}
