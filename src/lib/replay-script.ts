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
  const __pagepocketOriginalFetch = window.fetch ? window.fetch.bind(window) : null;

  const loadSnapshot = async () => {
    try {
      if (!__pagepocketOriginalFetch) {
        throw new Error("Fetch is unavailable");
      }
      const response = await __pagepocketOriginalFetch(requestsUrl);
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

  // Soften JSON parse failures to avoid halting replay flows.
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

  // Guard to reapply patches if overwritten later.
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
  let networkRecords = [];
  const byKey = new Map();

  const localResourceSet = new Set();
  const resourceUrlMap = new Map();

  const normalizeUrl = (input) => {
    try { return new URL(input, baseUrl).toString(); } catch { return input; }
  };

  let baseOrigin = "";
  let baseDir = "";
  try {
    const parsedBase = new URL(baseUrl);
    baseOrigin = parsedBase.origin;
    baseDir = new URL(".", parsedBase).toString().replace(/\\/$/, "");
  } catch {}


  const expandUrlVariants = (value) => {
    const variants = [];
    if (typeof value === "string") {
      variants.push(value);
      variants.push(normalizeUrl(value));
      if (baseOrigin && value.startsWith("/")) {
        variants.push(baseOrigin + value);
        if (baseDir) variants.push(baseDir + value);
      } else if (baseDir) {
        variants.push(baseDir + (value.startsWith("/") ? value : "/" + value));
      }
      try {
        const parsed = new URL(value, baseUrl);
        const pathWithSearch = (parsed.pathname || "") + (parsed.search || "");
        if (baseOrigin && parsed.origin !== baseOrigin) {
          variants.push(baseOrigin + pathWithSearch);
          if (baseDir) {
            const path = pathWithSearch.startsWith("/") ? pathWithSearch : "/" + pathWithSearch;
            variants.push(baseDir + path);
          }
        }
      } catch {}
    }
    return Array.from(new Set(variants.filter(Boolean)));
  };

  const normalizeBody = (body) => {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") return body;
    try { return String(body); } catch { return ""; }
  };

  // Build a stable key so requests with identical method/url/body match the same response.
  const makeKey = (method, url, body) => method.toUpperCase() + " " + normalizeUrl(url) + " " + normalizeBody(body);
  const makeVariantKeys = (method, url, body) => {
    return expandUrlVariants(url).map((variant) => makeKey(method, variant, body));
  };
  const primeLookups = (snapshot) => {
    records = snapshot.fetchXhrRecords || [];
    networkRecords = snapshot.networkRecords || [];
    byKey.clear();
    localResourceSet.clear();
    resourceUrlMap.clear();

    for (const record of records) {
      if (!record || !record.url || !record.method) continue;
      const keys = makeVariantKeys(record.method, record.url, record.requestBody || "");
      for (const key of keys) {
        if (!byKey.has(key)) {
          byKey.set(key, record);
        }
      }
    }

    for (const record of networkRecords) {
      if (!record || !record.url || !record.method) continue;
      const keys = makeVariantKeys(record.method, record.url, record.requestBody || "");
      for (const key of keys) {
        if (!byKey.has(key)) {
          byKey.set(key, record);
        }
      }
    }

    // Track local resource files and map original URLs to local paths.
    const resourceList = snapshot.resources || [];
    for (const item of resourceList) {
      if (!item || !item.localPath) continue;
      localResourceSet.add(item.localPath);
      localResourceSet.add("./" + item.localPath);

      if (item.url) {
        const variants = expandUrlVariants(item.url);
        for (const variant of variants) {
          resourceUrlMap.set(variant, item.localPath);
        }
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
    const variants = expandUrlVariants(url);
    for (const variant of variants) {
      const key = makeKey(method, variant, body);
      if (byKey.has(key)) return byKey.get(key);
    }
    for (const variant of variants) {
      const fallbackKey = makeKey(method, variant, "");
      if (byKey.has(fallbackKey)) return byKey.get(fallbackKey);
    }
    for (const variant of variants) {
      const getKey = makeKey("GET", variant, "");
      if (byKey.has(getKey)) return byKey.get(getKey);
    }
    return null;
  };

  const findByUrl = (url) => {
    if (isLocalResource(url)) return null;
    const variants = expandUrlVariants(url);
    for (const variant of variants) {
      const direct = byKey.get(makeKey("GET", variant, ""));
      if (direct) return direct;
    }
    // Attempt a looser match: ignore querystring if needed.
    for (const variant of variants) {
      try {
        const withoutQuery = new URL(variant).origin + new URL(variant).pathname;
        const direct = byKey.get(makeKey("GET", withoutQuery, ""));
        if (direct) return direct;
      } catch {}
    }
    return null;
  };

  const findLocalPath = (url) => {
    if (!url) return null;
    const variants = expandUrlVariants(url);
    for (const variant of variants) {
      const hit = resourceUrlMap.get(variant);
      if (hit) return hit;
    }
    for (const variant of variants) {
      try {
        const withoutQuery = new URL(variant).origin + new URL(variant).pathname;
        const hit = resourceUrlMap.get(withoutQuery);
        if (hit) return hit;
      } catch {}
    }
    // If still not found, fallback to data URLs if present.
    return null;
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
