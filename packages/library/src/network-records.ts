import type { CapturedNetworkRecord, NetworkRecord } from "./types";

const getHeaderValue = (headers: Record<string, string>, name: string) => {
  for (const key in headers) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
};

const toBase64 = (value: string) => {
  const bufferConstructor = (
    globalThis as {
      Buffer?: {
        from(data: string, encoding?: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return bufferConstructor.from(value, "utf-8").toString("base64");
  }
  if (typeof btoa === "function") {
    return btoa(value);
  }
  return "";
};

export const toDataUrlFromRecord = (record: NetworkRecord) => {
  if (!record) return null;
  const headers = record.responseHeaders || {};
  const contentType = getHeaderValue(headers, "content-type") || "application/octet-stream";

  if (record.responseEncoding === "base64" && record.responseBodyBase64) {
    return `data:${contentType};base64,${record.responseBodyBase64}`;
  }

  if (record.responseBody) {
    const encoded = toBase64(record.responseBody);
    if (!encoded) {
      return null;
    }
    return `data:${contentType};base64,${encoded}`;
  }

  return null;
};

export const findFaviconDataUrl = (records: NetworkRecord[]) => {
  for (const record of records) {
    if (!record || !record.url) continue;
    const headers = record.responseHeaders || {};
    const contentType = (getHeaderValue(headers, "content-type") || "").toLowerCase();
    const pathname = (() => {
      try {
        return new URL(record.url).pathname;
      } catch {
        return record.url;
      }
    })();

    const looksLikeFavicon =
      contentType.includes("icon") || /favicon(\.[a-z0-9]+)?$/i.test(pathname || "");
    if (!looksLikeFavicon) continue;

    const dataUrl = toDataUrlFromRecord(record);
    if (dataUrl) return dataUrl;
  }
  return null;
};

export const mapCapturedNetworkRecords = (
  records: CapturedNetworkRecord[] | undefined
): NetworkRecord[] => {
  if (!records) return [];
  return records.map((record) => {
    const response = record.response;
    return {
      url: record.url,
      method: record.method,
      status: response?.status,
      statusText: response?.statusText,
      responseHeaders: response?.headers,
      responseBody: response?.bodyEncoding === "text" ? response.body : undefined,
      responseBodyBase64: response?.bodyEncoding === "base64" ? response.body : undefined,
      responseEncoding: response?.bodyEncoding,
      error: record.error,
      timestamp: record.timestamp
    };
  });
};
