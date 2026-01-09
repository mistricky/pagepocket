import type { SnapshotData } from "./types";

export const buildReplayScript = (snapshot: SnapshotData, baseUrl: string) => {
  const payload = JSON.stringify(snapshot).replace(/<\/script>/gi, "<\\/script>");
  const basePayload = JSON.stringify(baseUrl);
  return `
<script>
(function(){
  // Deserialize the snapshot and prepare lookup tables for offline responses.
  const snapshot = ${payload} || {};
  const records = snapshot.fetchXhrRecords || [];
  const networkRecords = snapshot.networkRecords || [];
  const baseUrl = ${basePayload};

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
  const byKey = new Map();

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
  const localResourceSet = new Set();
  const resourceUrlMap = new Map();
  const resourceList = snapshot.resources || [];

  for (const item of resourceList) {
    if (!item || !item.localPath) continue;
    localResourceSet.add(item.localPath);
    localResourceSet.add("./" + item.localPath);

    if (item.url) {
      resourceUrlMap.set(normalizeUrl(item.url), item.localPath);
    }
  }

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

  // Patch fetch to serve from recorded network data.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || (typeof input === "string" ? "GET" : input.method || "GET");
    const body = init && init.body;
    const record = findRecord(method, url, body);
    if (record) {
      return responseFromRecord(record);
    }
    return new Response("", { status: 404, statusText: "Not Found" });
  };

  // Patch XHR so app code sees consistent responses offline.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__websnapMethod = method;
    this.__websnapUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const method = this.__websnapMethod || "GET";
    const url = this.__websnapUrl || "";
    const record = findRecord(method, url, body);
    if (record) {
      const xhr = this;
      const responseText = record.responseBody || "";
      const status = record.status || 200;
      const statusText = record.statusText || "OK";

      setTimeout(() => {
        defineProp(xhr, "readyState", 4);
        defineProp(xhr, "status", status);
        defineProp(xhr, "statusText", statusText);
        if (xhr.responseType === "arraybuffer" && record.responseBodyBase64) {
          const bytes = decodeBase64(record.responseBodyBase64);
          defineProp(xhr, "response", bytes.buffer);
          defineProp(xhr, "responseText", "");
        } else if (xhr.responseType === "blob" && record.responseBodyBase64) {
          const bytes = decodeBase64(record.responseBodyBase64);
          defineProp(xhr, "response", new Blob([bytes]));
          defineProp(xhr, "responseText", "");
        } else {
          defineProp(xhr, "response", responseText);
          defineProp(xhr, "responseText", responseText);
        }
        if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange();
        if (typeof xhr.onload === "function") xhr.onload(new Event("load"));
        if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));
        if (xhr.dispatchEvent) {
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new Event("load"));
          xhr.dispatchEvent(new Event("loadend"));
        }
      }, 0);
      return;
    }
    const xhr = this;
    const status = 404;
    const statusText = "Not Found";

    setTimeout(() => {
      defineProp(xhr, "readyState", 4);
      defineProp(xhr, "status", status);
      defineProp(xhr, "statusText", statusText);
      defineProp(xhr, "response", "");
      defineProp(xhr, "responseText", "");
      if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange();
      if (typeof xhr.onload === "function") xhr.onload(new Event("load"));
      if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));
      if (xhr.dispatchEvent) {
        xhr.dispatchEvent(new Event("readystatechange"));
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      }
    }, 0);
    return;
  };

  // Placeholder data URLs for missing resources.
  const transparentGif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const emptyScript = "data:text/javascript,/*websnap-missing*/";
  const emptyStyle = "data:text/css,/*websnap-missing*/";

  // Rewrite srcset values so each candidate is local or data-backed.
  const rewriteSrcset = (value) => {
    if (!value) return value;
    return value.split(",").map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const pieces = trimmed.split(/\\s+/, 2);
      const url = pieces[0];
      const descriptor = pieces[1];
      if (isLocalResource(url)) return trimmed;
      const localPath = findLocalPath(url);
      if (localPath) {
        return descriptor ? localPath + " " + descriptor : localPath;
      }
      const record = findByUrl(url);
      const replacement = record ? toDataUrl(record) : transparentGif;
      return descriptor ? replacement + " " + descriptor : replacement;
    }).join(", ");
  };

  // Rewrite element attributes to local files or data URLs.
  const rewriteElement = (element) => {
    if (!element || !element.getAttribute) return;
    const tag = (element.tagName || "").toLowerCase();
    if (tag === "img" || tag === "source" || tag === "video" || tag === "audio" || tag === "script" || tag === "iframe") {
      const src = element.getAttribute("src");
      if (src && !isLocalResource(src) && !src.startsWith("data:") && !src.startsWith("blob:")) {
        const localPath = findLocalPath(src);
        if (localPath) {
          element.setAttribute("src", localPath);
          return;
        }
        const record = findByUrl(src);
        const fallback = tag === "script" ? emptyScript : transparentGif;
        element.setAttribute("src", record ? toDataUrl(record) : fallback);
      }
    }

    if (tag === "link") {
      const href = element.getAttribute("href");
      if (href && !isLocalResource(href) && !href.startsWith("data:") && !href.startsWith("blob:")) {
        const localPath = findLocalPath(href);
        if (localPath) {
          element.setAttribute("href", localPath);
          return;
        }
        const record = findByUrl(href);
        const rel = (element.getAttribute("rel") || "").toLowerCase();
        const fallback = rel === "stylesheet" ? emptyStyle : emptyStyle;
        element.setAttribute("href", record ? toDataUrl(record, "text/css") : fallback);
      }
    }

    const srcset = element.getAttribute("srcset");
    if (srcset) {
      element.setAttribute("srcset", rewriteSrcset(srcset));
    }
  };

  // Intercept DOM attribute writes to keep resources local.
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const attr = String(name).toLowerCase();
    if (attr === "src" || attr === "href" || attr === "srcset") {
      if (attr === "srcset") {
        const rewritten = rewriteSrcset(String(value));
        return originalSetAttribute.call(this, name, rewritten);
      }

      if (isLocalResource(String(value))) {
        return originalSetAttribute.call(this, name, value);
      }
      const localPath = findLocalPath(String(value));
      if (localPath) {
        return originalSetAttribute.call(this, name, localPath);
      }
      const record = findByUrl(String(value));
      if (record) {
        const dataUrl = toDataUrl(record);
        return originalSetAttribute.call(this, name, dataUrl);
      }
      const tag = (this.tagName || "").toLowerCase();
      if (attr === "src") {
        const fallback = tag === "script" ? emptyScript : transparentGif;
        return originalSetAttribute.call(this, name, fallback);
      }
      if (attr === "href") {
        const rel = (this.getAttribute && this.getAttribute("rel")) || "";
        const fallback = rel.toLowerCase() === "stylesheet" ? emptyStyle : emptyStyle;
        return originalSetAttribute.call(this, name, fallback);
      }
    }
    return originalSetAttribute.call(this, name, value);
  };

  // Patch property setters (e.g. img.src) so direct assignments are rewritten.
  const patchProperty = (proto, prop, handler) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get: desc.get,
        set: function(value) {
          return handler.call(this, value, desc.set);
        }
      });
    } catch {}
  };

  patchProperty(HTMLImageElement.prototype, "src", function(value, setter) {
    if (isLocalResource(String(value))) {
      setter.call(this, value);
      return;
    }
    const localPath = findLocalPath(String(value));
    if (localPath) {
      setter.call(this, localPath);
      return;
    }
    const record = findByUrl(String(value));
    const next = record ? toDataUrl(record) : transparentGif;
    setter.call(this, next);
  });

  patchProperty(HTMLScriptElement.prototype, "src", function(value, setter) {
    if (isLocalResource(String(value))) {
      setter.call(this, value);
      return;
    }
    const localPath = findLocalPath(String(value));
    if (localPath) {
      setter.call(this, localPath);
      return;
    }
    const record = findByUrl(String(value));
    const next = record ? toDataUrl(record) : emptyScript;
    setter.call(this, next);
  });

  patchProperty(HTMLLinkElement.prototype, "href", function(value, setter) {
    if (isLocalResource(String(value))) {
      setter.call(this, value);
      return;
    }
    const localPath = findLocalPath(String(value));
    if (localPath) {
      setter.call(this, localPath);
      return;
    }
    const record = findByUrl(String(value));
    const next = record ? toDataUrl(record, "text/css") : emptyStyle;
    setter.call(this, next);
  });

  patchProperty(HTMLImageElement.prototype, "srcset", function(value, setter) {
    const next = rewriteSrcset(String(value));
    setter.call(this, next);
  });

  // Observe DOM mutations and rewrite any new elements or attributes.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target) {
        rewriteElement(mutation.target);
      }
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node && node.nodeType === 1) {
            rewriteElement(node);
            const descendants = node.querySelectorAll ? node.querySelectorAll("img,source,video,audio,script,link,iframe") : [];
            descendants.forEach((el) => rewriteElement(el));
          }
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["src", "href", "srcset"]
  });

  document.querySelectorAll("img,source,video,audio,script,link,iframe").forEach((el) => rewriteElement(el));

  // Stub beacon calls so analytics doesn't leak outside the snapshot.
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      const record = findRecord("POST", url, data);
      if (record) {
        return true;
      }
      return true;
    };
    navigator.sendBeacon.__websnapOriginal = originalBeacon;
  }

  // Stub WebSocket/EventSource to prevent live network connections.
  if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const socket = {
        url,
        readyState: 1,
        send: function() {},
        close: function() {},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
      };
      return socket;
    };
    window.WebSocket.__websnapOriginal = OriginalWebSocket;
  }

  if (window.EventSource) {
    const OriginalEventSource = window.EventSource;
    window.EventSource = function(url) {
      const source = {
        url,
        readyState: 1,
        close: function() {},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
      };
      return source;
    };
    window.EventSource.__websnapOriginal = OriginalEventSource;
  }
})();
</script>
`;
};
