import type { ScriptHacker } from "./types";

export const preloadXhrRecorder: ScriptHacker = {
  id: "preload-xhr-recorder",
  stage: "preload",
  build: () => `
  // Record XHR calls and responses for replay.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__websnapMethod = method;
    this.__websnapUrl = toAbsoluteUrl(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const requestBody = normalizeBody(body);

    const onLoadEnd = () => {
      const responseHeadersRaw = xhr.getAllResponseHeaders();
      const headers = {};
      responseHeadersRaw
        .trim()
        .split(/\\r?\\n/)
        .filter(Boolean)
        .forEach((line) => {
          const index = line.indexOf(":");
          if (index > -1) {
            const key = line.slice(0, index).trim().toLowerCase();
            const value = line.slice(index + 1).trim();
            headers[key] = value;
          }
        });

      records.push({
        kind: "xhr",
        url: xhr.__websnapUrl || "",
        method: xhr.__websnapMethod || "GET",
        requestBody,
        status: xhr.status,
        statusText: xhr.statusText,
        responseHeaders: headers,
        responseBody: xhr.responseText || "",
        timestamp: Date.now()
      });

      xhr.removeEventListener("loadend", onLoadEnd);
    };

    xhr.addEventListener("loadend", onLoadEnd);
    return originalSend.call(xhr, body);
  };
`
};
