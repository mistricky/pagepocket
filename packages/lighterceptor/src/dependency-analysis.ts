import { extractCssDependencies, extractJsDependencies } from "./dependency-utils.js";
import type { ResourceKind } from "./lighterceptor-model.js";
import { inferResourceKindFromUrl, resolveUrl } from "./resource-utils.js";
import type { RequestSource } from "./types.js";

type RecordUrl = (url: string, source: RequestSource | "unknown", baseUrl?: string) => void;
type Enqueue = (url: string, kind?: ResourceKind) => void;

export function recordCssUrls(
  cssText: string,
  baseUrl: string | undefined,
  recordUrl: RecordUrl,
  enqueue: Enqueue
) {
  const { imports, urls } = extractCssDependencies(cssText);

  for (const url of imports) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "css");
    enqueue(resolved, "css");
  }

  for (const url of urls) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "css");
  }
}

export function analyzeJs(
  jsText: string,
  baseUrl: string | undefined,
  recordUrl: RecordUrl,
  enqueue: Enqueue
) {
  const { fetches, imports, importScripts, xhrs } = extractJsDependencies(jsText);

  for (const url of imports) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "resource");
    enqueue(resolved, inferResourceKindFromUrl(resolved) ?? "js");
  }

  for (const url of importScripts) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "resource");
    enqueue(resolved, "js");
  }

  for (const url of fetches) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "fetch");
    enqueue(resolved, inferResourceKindFromUrl(resolved));
  }

  for (const url of xhrs) {
    const resolved = resolveUrl(baseUrl, url);
    if (!resolved) {
      continue;
    }
    recordUrl(resolved, "xhr");
    enqueue(resolved, inferResourceKindFromUrl(resolved));
  }
}
