import { isTextResponse } from "./content-type";
import type { BodySource } from "./types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const hashString = (value: string) => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const stripLeadingSlash = (value: string) => value.replace(/^\/+/, "");

export const ensureLeadingSlash = (value: string) =>
  value.startsWith("/") ? value : `/${value}`;

export const sanitizePosixPath = (value: string) => {
  const parts = value.split("/").filter(Boolean);
  const clean: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") continue;
    clean.push(part);
  }
  return clean.join("/");
};

const getGlobalBuffer = () => {
  return (globalThis as { Buffer?: typeof Buffer }).Buffer;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  const BufferCtor = getGlobalBuffer();
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};

export const isUtf8Text = (bytes: Uint8Array, mimeType?: string) => {
  const decoded = decodeUtf8(bytes);
  if (decoded === null) {
    return false;
  }
  if (mimeType) {
    return isTextResponse(mimeType);
  }
  return true;
};

export const toUint8Array = async (body: BodySource): Promise<Uint8Array> => {
  if (body.kind === "buffer") {
    return body.data;
  }
  if (body.kind === "late") {
    return body.read();
  }
  const reader = body.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const value = result.value;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
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

export const bodyToTextOrBase64 = (bytes: Uint8Array, mimeType?: string) => {
  if (isUtf8Text(bytes, mimeType)) {
    const text = decodeUtf8(bytes) ?? "";
    return { encoding: "text" as const, text };
  }
  return { encoding: "base64" as const, base64: bytesToBase64(bytes) };
};
