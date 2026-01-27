import { replayHackers } from "./hackers";
import type { HackerContext } from "./hackers/types";

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
    const key = makeKey(method, url, body);
    if (byKey.has(key)) return byKey.get(key);
    const fallbackKey = makeKey(method, url, "");
    if (byKey.has(fallbackKey)) return byKey.get(fallbackKey);
    const getKey = makeKey("GET", url, "");
    if (byKey.has(getKey)) return byKey.get(getKey);
    return null;
  };

  const findByUrl = (url) => {
    if (isLocalResource(url)) return null;
    const direct = byKey.get(makeKey("GET", url, ""));
    if (direct) return direct;
    return null;
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
