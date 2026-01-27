import { write } from "@pagepocket/uni-fs";

import type { PageSnapshot, WriteFSOptions, WriteResult, ZipOptions } from "./types";
import { stripLeadingSlash } from "./utils";

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const joinPath = (base: string, relative: string) => {
  const cleanBase = normalizePath(base).replace(/\/+$/, "");
  const cleanRel = normalizePath(relative).replace(/^\/+/, "");
  if (!cleanBase) {
    return cleanRel;
  }
  return `${cleanBase}/${cleanRel}`;
};

const splitPathExtension = (value: string) => {
  const clean = normalizePath(value);
  const lastSlash = clean.lastIndexOf("/");
  const lastDot = clean.lastIndexOf(".");
  if (lastDot > lastSlash) {
    return {
      filename: clean.slice(0, lastDot),
      extension: clean.slice(lastDot + 1)
    };
  }
  return { filename: clean, extension: "" };
};

const streamToUint8Array = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value) {
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export const writeToFS = async (
  snapshot: PageSnapshot,
  outDir: string,
  options?: WriteFSOptions
): Promise<WriteResult> => {
  let filesWritten = 0;
  let totalBytes = 0;

  for (const file of snapshot.files) {
    const relative = stripLeadingSlash(file.path);
    const outputPath = joinPath(outDir, relative);
    const { filename, extension } = splitPathExtension(outputPath);
    const stream = await snapshot.content.open(file.source);
    const data = await streamToUint8Array(stream);
    await write(filename, extension, data);
    filesWritten += 1;
    totalBytes += data.byteLength;
  }

  if (options?.clearCache ?? true) {
    await snapshot.content.dispose?.();
  }

  return { filesWritten, totalBytes };
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const writeUint16 = (value: number) => {
  const buffer = new Uint8Array(2);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, value, true);
  return buffer;
};

const writeUint32 = (value: number) => {
  const buffer = new Uint8Array(4);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, value, true);
  return buffer;
};

const concatBytes = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export const toZip = async (
  snapshot: PageSnapshot,
  options?: ZipOptions
): Promise<Uint8Array | Blob> => {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of snapshot.files) {
    const name = stripLeadingSlash(file.path);
    const nameBytes = new TextEncoder().encode(name);
    const stream = await snapshot.content.open(file.source);
    const data = await streamToUint8Array(stream);
    const crc = crc32(data);

    const localHeader = concatBytes([
      writeUint32(0x04034b50),
      writeUint16(20),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(crc),
      writeUint32(data.byteLength),
      writeUint32(data.byteLength),
      writeUint16(nameBytes.byteLength),
      writeUint16(0),
      nameBytes
    ]);

    localChunks.push(localHeader, data);

    const centralHeader = concatBytes([
      writeUint32(0x02014b50),
      writeUint16(20),
      writeUint16(20),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(crc),
      writeUint32(data.byteLength),
      writeUint32(data.byteLength),
      writeUint16(nameBytes.byteLength),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(0),
      writeUint32(offset),
      nameBytes
    ]);
    centralChunks.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectory = concatBytes(centralChunks);
  const endRecord = concatBytes([
    writeUint32(0x06054b50),
    writeUint16(0),
    writeUint16(0),
    writeUint16(snapshot.files.length),
    writeUint16(snapshot.files.length),
    writeUint32(centralDirectory.byteLength),
    writeUint32(offset),
    writeUint16(0)
  ]);

  const zipBytes = concatBytes([...localChunks, centralDirectory, endRecord]);
  const output = options?.asBlob && typeof Blob !== "undefined"
    ? new Blob([zipBytes], { type: "application/zip" })
    : zipBytes;

  if (options?.clearCache ?? true) {
    await snapshot.content.dispose?.();
  }

  return output;
};
