import { replayHackers } from "./hackers";
import type { HackerContext } from "./hackers/types";
import type { ApiRecord } from "./types";

export type MatchApiOptions = {
  records: ApiRecord[];
  byKey?: Map<string, ApiRecord>;
  baseUrl: string;
  method: string;
  url: string;
  body?: unknown;
};

export function matchAPI(options: MatchApiOptions): ApiRecord | undefined {
  const { records, byKey, baseUrl, method, url, body } = options;

  const normalizeBody = (value: unknown) => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
      return String(value);
    } catch {
      return "";
    }
  };

  const normalizeUrl = (input: string) => {
    try {
      return new URL(input, baseUrl).toString();
    } catch {
      return input;
    }
  };

  const stripHash = (value: string) => {
    const index = value.indexOf("#");
    return index === -1 ? value : value.slice(0, index);
  };

  const stripTrailingSlash = (value: string) => {
    if (value.length > 1 && value.endsWith("/")) {
      return value.slice(0, -1);
    }
    return value;
  };

  const safeUrl = (input: string) => {
    try {
      return new URL(input, baseUrl);
    } catch {
      return null;
    }
  };

  const toPathSearch = (input: string) => {
    const parsed = safeUrl(input);
    if (!parsed) return input;
    return parsed.pathname + parsed.search;
  };

  const toPathname = (input: string) => {
    const parsed = safeUrl(input);
    return parsed ? parsed.pathname : input;
  };

  const buildUrlVariants = (input: string) => {
    const variants = new Set<string>();
    const push = (value: string | undefined | null) => {
      if (!value) return;
      variants.add(value);
    };

    const raw = String(input ?? "");
    push(raw);
    push(stripHash(raw));
    push(stripTrailingSlash(raw));
    push(stripTrailingSlash(stripHash(raw)));

    const absolute = normalizeUrl(raw);
    push(absolute);
    const absoluteNoHash = stripHash(absolute);
    push(absoluteNoHash);
    push(stripTrailingSlash(absoluteNoHash));

    const pathSearch = toPathSearch(raw);
    push(pathSearch);
    push(stripTrailingSlash(pathSearch));

    const pathname = toPathname(raw);
    push(pathname);
    push(stripTrailingSlash(pathname));

    return Array.from(variants);
  };

  const makeKey = (keyMethod: string, keyUrl: string, keyBody: string) =>
    keyMethod.toUpperCase() + " " + normalizeUrl(keyUrl) + " " + normalizeBody(keyBody);

  const urlVariants = buildUrlVariants(url);
  const bodyValue = normalizeBody(body);
  const methodValue = (method || "GET").toUpperCase();

  const tryLookup = (keyMethod: string, keyBody: string) => {
    if (!byKey) return undefined;
    for (const urlVariant of urlVariants) {
      const record = byKey.get(makeKey(keyMethod, urlVariant, keyBody));
      if (record) return record;
    }
    return undefined;
  };

  const matchOrder: Array<[string, string]> = [
    [methodValue, bodyValue],
    [methodValue, ""],
    ["GET", ""],
    ["GET", bodyValue]
  ];

  for (const [keyMethod, keyBody] of matchOrder) {
    const record = tryLookup(keyMethod, keyBody);
    if (record) return record;
  }

  const urlMatches = (inputUrl: string, recordUrl: string) => {
    const inputAbs = stripHash(normalizeUrl(inputUrl));
    const recordAbs = stripHash(normalizeUrl(recordUrl));
    if (inputAbs === recordAbs) return true;

    const inputPathSearch = stripTrailingSlash(toPathSearch(inputUrl));
    const recordPathSearch = stripTrailingSlash(toPathSearch(recordUrl));
    if (inputPathSearch === recordPathSearch) return true;

    const inputPath = stripTrailingSlash(toPathname(inputUrl));
    const recordPath = stripTrailingSlash(toPathname(recordUrl));
    if (inputPath === recordPath) return true;

    return false;
  };

  const scanRecords = (keyMethod: string, keyBody: string) => {
    for (const record of records || []) {
      if (!record || !record.url || !record.method) continue;
      if (record.method.toUpperCase() !== keyMethod) continue;
      if (!urlMatches(url, record.url)) continue;

      const recordBody = record.requestBody || record.requestBodyBase64 || "";
      if (keyBody && recordBody !== keyBody) continue;
      return record;
    }
    return undefined;
  };

  for (const [keyMethod, keyBody] of matchOrder) {
    const record = scanRecords(keyMethod, keyBody);
    if (record) return record;
  }

  return undefined;
}

export const buildReplayScript = (apiPath: string, baseUrl: string) => {
  const basePayload = JSON.stringify(baseUrl);
  const apiPayload = JSON.stringify(apiPath);
  const context: HackerContext = { stage: "replay" };
  const hackerScripts = replayHackers
    .map((hacker) => `  // hacker:${hacker.id}\n${hacker.build(context)}`)
    .join("\n");

  return `
<script>
(function(){
  const baseUrl = ${basePayload};
  const apiUrl = ${apiPayload};
  const __pagepocketOriginalFetch = window.fetch ? window.fetch.bind(window) : null;

  const loadApiSnapshot = async () => {
    try {
      if (!__pagepocketOriginalFetch) {
        throw new Error("Fetch is unavailable");
      }
      const response = await __pagepocketOriginalFetch(apiUrl);
      if (!response.ok) {
        throw new Error("Failed to load api.json");
      }
      return await response.json();
    } catch {
      return { version: "1.0", url: baseUrl, createdAt: 0, records: [] };
    }
  };

  const originalResponseJson = Response && Response.prototype && Response.prototype.json;
  if (originalResponseJson) {
    Response.prototype.json = function(...args) {
      try {
        return originalResponseJson.apply(this, args).catch(() => null);
      } catch {
        return Promise.resolve(null);
      }
    };
  }

  const ensureReplayPatches = () => {
    try {
      if (!window.fetch.__pagepocketOriginal && typeof __pagepocketOriginalFetch === "function") {
        window.fetch.__pagepocketOriginal = __pagepocketOriginalFetch;
      }
    } catch {}
    try {
      if (!XMLHttpRequest.prototype.send.__pagepocketOriginal) {
        XMLHttpRequest.prototype.send.__pagepocketOriginal = XMLHttpRequest.prototype.send;
      }
    } catch {}
  };

  let records = [];
  const byKey = new Map();

  const normalizeUrl = (input) => {
    try { return new URL(input, baseUrl).toString(); } catch { return input; }
  };

  const normalizeBody = (body) => {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") return body;
    try { return String(body); } catch { return ""; }
  };

  const makeKey = (method, url, body) => method.toUpperCase() + " " + normalizeUrl(url) + " " + normalizeBody(body);
  const makeVariantKeys = (method, url, body) => [makeKey(method, url, body)];

  const matchAPI = ${matchAPI.toString()};

  const primeLookups = (snapshot) => {
    records = snapshot.records || [];
    byKey.clear();
    for (const record of records) {
      if (!record || !record.url || !record.method) continue;
      const keys = makeVariantKeys(record.method, record.url, record.requestBody || record.requestBodyBase64 || "");
      for (const key of keys) {
        if (!byKey.has(key)) {
          byKey.set(key, record);
        }
      }
    }
  };

  const ready = (async () => {
    const snapshot = (await loadApiSnapshot()) || {};
    primeLookups(snapshot);
    return snapshot;
  })();

  const isLocalResource = (value) => {
    if (!value) return false;
    if (value.startsWith("data:") || value.startsWith("blob:")) return true;
    if (value.startsWith("/")) return true;
    return false;
  };

  const findRecord = (method, url, body) => {
    return matchAPI({ records, byKey, baseUrl, method, url, body });
  };

  const findByUrl = (url) => {
    if (isLocalResource(url)) return null;
    return matchAPI({ records, byKey, baseUrl, method: "GET", url, body: "" });
  };

  const findLocalPath = () => null;

  const defineProp = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, configurable: true });
    } catch {}
  };

  const decodeBase64 = (input) => {
    try {
      const binary = atob(input || "");
      const bytes = new Uint8Array(binary.length);
      Array.from(binary).forEach((char, index) => {
        bytes[index] = char.charCodeAt(0);
      });
      return bytes;
    } catch {
      return new Uint8Array();
    }
  };

  const bytesToBase64 = (bytes) => {
    const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
    return btoa(binary);
  };

  const textToBase64 = (text) => {
    try {
      const bytes = new TextEncoder().encode(text || "");
      return bytesToBase64(bytes);
    } catch {
      return btoa(text || "");
    }
  };

  const getContentType = (record) => {
    const headers = record.responseHeaders || {};
    for (const key in headers) {
      if (key.toLowerCase() === "content-type") {
        return headers[key] || "application/octet-stream";
      }
    }
    return "application/octet-stream";
  };

  const toDataUrl = (record, fallbackType) => {
    if (!record) return "";
    const contentType = getContentType(record) || fallbackType || "application/octet-stream";
    if (record.responseEncoding === "base64" && record.responseBodyBase64) {
      return "data:" + contentType + ";base64," + record.responseBodyBase64;
    }
    if (record.responseBody) {
      return "data:" + contentType + ";base64," + textToBase64(record.responseBody);
    }
    return "data:" + (fallbackType || "application/octet-stream") + ",";
  };

  const responseFromRecord = (record) => {
    const headers = new Headers(record.responseHeaders || {});
    if (record.responseEncoding === "base64" && record.responseBodyBase64) {
      const bytes = decodeBase64(record.responseBodyBase64);
      return new Response(bytes, {
        status: record.status || 200,
        statusText: record.statusText || "OK",
        headers
      });
    }
    const bodyText = record.responseBody || "";
    return new Response(bodyText, {
      status: record.status || 200,
      statusText: record.statusText || "OK",
      headers
    });
  };

${hackerScripts}
})();
</script>
`;
};
