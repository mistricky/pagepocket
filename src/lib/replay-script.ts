import { replayHackers } from "./hackers";
import type { HackerContext } from "./hackers/types";

export const buildReplayScript = (requestsPath: string, baseUrl: string) => {
  const basePayload = JSON.stringify(baseUrl);
  const requestsPayload = JSON.stringify(requestsPath);
  const context: HackerContext = { stage: "replay" };
  const hackerScripts = replayHackers
    .map((hacker) => `  // hacker:${hacker.id}\n${hacker.build(context)}`)
    .join("\n");

  return `
<script>
(function(){
  // Load the snapshot metadata before patching runtime APIs.
  const baseUrl = ${basePayload};
  const requestsUrl = ${requestsPayload};
  const __webechoOriginalFetch = window.fetch ? window.fetch.bind(window) : null;

  const loadSnapshot = async () => {
    try {
      if (!__webechoOriginalFetch) {
        throw new Error("Fetch is unavailable");
      }
      const response = await __webechoOriginalFetch(requestsUrl);
      if (!response.ok) {
        throw new Error("Failed to load snapshot metadata");
      }
      return await response.json();
    } catch {
      return {
        url: baseUrl,
        title: "",
        capturedAt: "",
        fetchXhrRecords: [],
        networkRecords: [],
        resources: []
      };
    }
  };

  let records = [];
  let networkRecords = [];
  const byKey = new Map();
  const localResourceSet = new Set();
  const resourceUrlMap = new Map();

  const normalizeUrl = (input) => {
    try { return new URL(input, baseUrl).toString(); } catch { return input; }
  };

  const normalizeBody = (body) => {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") return body;
    try { return String(body); } catch { return ""; }
  };

  // Build a stable key so requests with identical method/url/body match the same response.
  const makeKey = (method, url, body) => method.toUpperCase() + " " + normalizeUrl(url) + " " + normalizeBody(body);
  const primeLookups = (snapshot) => {
    records = snapshot.fetchXhrRecords || [];
    networkRecords = snapshot.networkRecords || [];
    byKey.clear();
    localResourceSet.clear();
    resourceUrlMap.clear();

    for (const record of records) {
      if (!record || !record.url || !record.method) continue;
      const key = makeKey(record.method, record.url, record.requestBody || "");
      if (!byKey.has(key)) byKey.set(key, record);
    }

    for (const record of networkRecords) {
      if (!record || !record.url || !record.method) continue;
      const key = makeKey(record.method, record.url, record.requestBody || "");
      if (!byKey.has(key)) byKey.set(key, record);
    }

    // Track local resource files and map original URLs to local paths.
    const resourceList = snapshot.resources || [];
    for (const item of resourceList) {
      if (!item || !item.localPath) continue;
      localResourceSet.add(item.localPath);
      localResourceSet.add("./" + item.localPath);

      if (item.url) {
        resourceUrlMap.set(normalizeUrl(item.url), item.localPath);
      }
    }
  };

  const ready = (async () => {
    // Deserialize the snapshot and prepare lookup tables for offline responses.
    const snapshot = (await loadSnapshot()) || {};
    primeLookups(snapshot);
    return snapshot;
  })();

  const isLocalResource = (value) => {
    if (!value) return false;
    if (value.startsWith("data:") || value.startsWith("blob:")) return true;
    return localResourceSet.has(value);
  };

  // Lookup helpers for request records and local assets.
  const findRecord = (method, url, body) => {
    const key = makeKey(method, url, body);
    if (byKey.has(key)) return byKey.get(key);
    const fallbackKey = makeKey(method, url, "");
    if (byKey.has(fallbackKey)) return byKey.get(fallbackKey);
    const getKey = makeKey("GET", url, "");
    return byKey.get(getKey);
  };

  const findByUrl = (url) => {
    if (isLocalResource(url)) return null;
    const normalized = normalizeUrl(url);
    const direct = byKey.get(makeKey("GET", normalized, ""));
    if (direct) return direct;
    return byKey.get(makeKey("GET", url, ""));
  };

  const findLocalPath = (url) => {
    if (!url) return null;
    const normalized = normalizeUrl(url);
    return resourceUrlMap.get(normalized) || null;
  };

  // Safe property injection for emulating XHR state transitions.
  const defineProp = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, configurable: true });
    } catch {}
  };

  // Base64 helpers for binary payloads.
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

  // Resolve a content type from recorded response headers.
  const getContentType = (record) => {
    const headers = record.responseHeaders || {};
    for (const key in headers) {
      if (key.toLowerCase() === "content-type") {
        return headers[key] || "application/octet-stream";
      }
    }
    return "application/octet-stream";
  };

  // Turn a recorded response into a data URL for inline usage.
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

  // Build a real Response object from the recorded payload.
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
