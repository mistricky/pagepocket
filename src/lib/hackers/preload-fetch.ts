import type { ScriptHacker } from "./types";

export const preloadFetchRecorder: ScriptHacker = {
  id: "preload-fetch-recorder",
  stage: "preload",
  build: () => `
  // Record fetch calls and responses for replay.
  const originalFetch = window.fetch.bind(window);
  const recordFetch = async (input, init) => {
    const url = typeof input === "string" ? toAbsoluteUrl(input) : toAbsoluteUrl(input.url);
    const method = init && init.method ? init.method : (typeof input === "string" ? "GET" : input.method || "GET");
    const requestBody = normalizeBody(init && init.body ? init.body : (typeof input === "string" ? undefined : input.body));

    try {
      const response = await originalFetch(input, init);
      const clone = response.clone();
      const responseBody = await clone.text();
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      records.push({
        kind: "fetch",
        url,
        method,
        requestBody,
        status: response.status,
        statusText: response.statusText,
        responseHeaders: headers,
        responseBody,
        timestamp: Date.now()
      });
      return response;
    } catch (error) {
      records.push({
        kind: "fetch",
        url,
        method,
        requestBody,
        error: String(error),
        timestamp: Date.now()
      });
      throw error;
    }
  };

  window.fetch = (input, init) => {
    return recordFetch(input, init);
  };
  window.fetch.__webechoOriginal = originalFetch;
`
};
