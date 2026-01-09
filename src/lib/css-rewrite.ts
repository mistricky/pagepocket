import fs from "node:fs/promises";
import type { NetworkRecord } from "./types";

const getHeaderValue = (headers: Record<string, string>, name: string) => {
  for (const key in headers) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
};

export const buildDataUrlMap = (records: NetworkRecord[]) => {
  const map = new Map<string, string>();
  for (const record of records) {
    if (!record || !record.url || !record.responseBodyBase64) {
      continue;
    }
    const headers = record.responseHeaders || {};
    const contentType = getHeaderValue(headers, "content-type") || "application/octet-stream";
    map.set(record.url, `data:${contentType};base64,${record.responseBodyBase64}`);
  }
  return map;
};

export const rewriteCssUrls = async (
  filePath: string,
  cssUrl: string,
  dataUrlMap: Map<string, string>
) => {
  const css = await fs.readFile(filePath, "utf-8");
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const rewritten = css.replace(urlPattern, (match, quote, rawUrl) => {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return match;
    }
    let absolute = trimmed;
    try {
      absolute = new URL(trimmed, cssUrl).toString();
    } catch {
      return match;
    }
    const dataUrl = dataUrlMap.get(absolute);
    if (!dataUrl) {
      return match;
    }
    const safeQuote = quote || "";
    return `url(${safeQuote}${dataUrl}${safeQuote})`;
  });
  if (rewritten !== css) {
    await fs.writeFile(filePath, rewritten, "utf-8");
  }
};
