(function () {
  if ((window as any).__websnapPatched) {
    return;
  }
  Object.defineProperty(window, "__websnapPatched", { value: true });

  const records: any[] = [];
  (window as any).__websnapRecords = records;

  const toAbsoluteUrl = (input: string) => {
    try {
      return new URL(input, window.location.href).toString();
    } catch {
      return input;
    }
  };

  const normalizeBody = (body: any) => {
    if (body === undefined || body === null) {
      return "";
    }
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof ArrayBuffer) {
      try {
        return new TextDecoder().decode(body);
      } catch {
        return "";
      }
    }
    if (body instanceof Blob) {
      return "";
    }
    return String(body);
  };

  const recordFetch = async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? toAbsoluteUrl(input) : toAbsoluteUrl(input.url);
    const method = init?.method || (typeof input === "string" ? "GET" : input.method || "GET");
    const requestBody = normalizeBody(init?.body || (typeof input === "string" ? undefined : input.body));

    try {
      const response = await originalFetch(input, init);
      const clone = response.clone();
      const responseBody = await clone.text();
      const headers: Record<string, string> = {};
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
    } catch (error: any) {
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

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return recordFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
  (window.fetch as any).__websnapOriginal = originalFetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    (this as any).__websnapMethod = method;
    (this as any).__websnapUrl = toAbsoluteUrl(url);
    return (originalOpen as any).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | BodyInit | null) {
    const xhr = this;
    const requestBody = normalizeBody(body);

    const onLoadEnd = () => {
      const responseHeadersRaw = xhr.getAllResponseHeaders();
      const headers: Record<string, string> = {};
      responseHeadersRaw
        .trim()
        .split(/\r?\n/)
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
        url: (xhr as any).__websnapUrl || "",
        method: (xhr as any).__websnapMethod || "GET",
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
    return originalSend.call(xhr, body as any);
  };
})();
