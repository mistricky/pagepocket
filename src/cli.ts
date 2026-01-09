#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

export type FetchRecord = {
  kind: "fetch" | "xhr";
  url: string;
  method: string;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
  timestamp: number;
};

type NetworkRecord = {
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyBase64?: string;
  responseEncoding?: "text" | "base64";
  error?: string;
  timestamp: number;
};

type SnapshotData = {
  url: string;
  title: string;
  capturedAt: string;
  fetchXhrRecords: FetchRecord[];
  networkRecords: NetworkRecord[];
  resources: Array<{
    url: string;
    localPath: string;
    contentType?: string | null;
    size?: number;
  }>;
};

const usage = () => {
  return "Usage: websnap <url>";
};

const safeFilename = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return "snapshot";
  }
  return (
    trimmed
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "snapshot"
  );
};

const buildReplayScript = (snapshot: SnapshotData, baseUrl: string) => {
  const payload = JSON.stringify(snapshot).replace(
    /<\/script>/gi,
    "<\\/script>",
  );
  const basePayload = JSON.stringify(baseUrl);
  return `\n<script>\n(function(){\n  const snapshot = ${payload} || {};\n  const records = snapshot.fetchXhrRecords || [];\n  const networkRecords = snapshot.networkRecords || [];\n  const baseUrl = ${basePayload};\n  const normalizeUrl = (input) => {\n    try { return new URL(input, baseUrl).toString(); } catch { return input; }\n  };\n  const normalizeBody = (body) => {\n    if (body === undefined || body === null) return "";\n    if (typeof body === "string") return body;\n    try { return String(body); } catch { return ""; }\n  };\n  const makeKey = (method, url, body) => method.toUpperCase() + " " + normalizeUrl(url) + " " + normalizeBody(body);\n  const byKey = new Map();\n  for (const record of records) {\n    if (!record || !record.url || !record.method) continue;\n    const key = makeKey(record.method, record.url, record.requestBody || "");\n    if (!byKey.has(key)) byKey.set(key, record);\n  }\n  for (const record of networkRecords) {\n    if (!record || !record.url || !record.method) continue;\n    const key = makeKey(record.method, record.url, record.requestBody || "");\n    if (!byKey.has(key)) byKey.set(key, record);\n  }\n  const localResourceSet = new Set();\n  const resourceUrlMap = new Map();\n  const resourceList = snapshot.resources || [];\n  for (const item of resourceList) {\n    if (!item || !item.localPath) continue;\n    localResourceSet.add(item.localPath);\n    localResourceSet.add("./" + item.localPath);\n    if (item.url) {\n      resourceUrlMap.set(normalizeUrl(item.url), item.localPath);\n    }\n  }\n  const isLocalResource = (value) => {\n    if (!value) return false;\n    if (value.startsWith("data:") || value.startsWith("blob:")) return true;\n    return localResourceSet.has(value);\n  };\n  const findRecord = (method, url, body) => {\n    const key = makeKey(method, url, body);\n    if (byKey.has(key)) return byKey.get(key);\n    const fallbackKey = makeKey(method, url, "");\n    if (byKey.has(fallbackKey)) return byKey.get(fallbackKey);\n    const getKey = makeKey("GET", url, "");\n    return byKey.get(getKey);\n  };\n  const findByUrl = (url) => {\n    if (isLocalResource(url)) return null;\n    const normalized = normalizeUrl(url);\n    const direct = byKey.get(makeKey("GET", normalized, ""));\n    if (direct) return direct;\n    return byKey.get(makeKey("GET", url, ""));\n  };\n  const findLocalPath = (url) => {\n    if (!url) return null;\n    const normalized = normalizeUrl(url);\n    return resourceUrlMap.get(normalized) || null;\n  };\n  const defineProp = (obj, key, value) => {\n    try {\n      Object.defineProperty(obj, key, { value, configurable: true });\n    } catch {}\n  };\n  const decodeBase64 = (input) => {\n    try {\n      const binary = atob(input || "");\n      const bytes = new Uint8Array(binary.length);\n      for (let i = 0; i < binary.length; i++) {\n        bytes[i] = binary.charCodeAt(i);\n      }\n      return bytes;\n    } catch {\n      return new Uint8Array();\n    }\n  };\n  const bytesToBase64 = (bytes) => {\n    let binary = "";\n    for (let i = 0; i < bytes.length; i++) {\n      binary += String.fromCharCode(bytes[i]);\n    }\n    return btoa(binary);\n  };\n  const textToBase64 = (text) => {\n    try {\n      const bytes = new TextEncoder().encode(text || "");\n      return bytesToBase64(bytes);\n    } catch {\n      return btoa(text || "");\n    }\n  };\n  const getContentType = (record) => {\n    const headers = record.responseHeaders || {};\n    for (const key in headers) {\n      if (key.toLowerCase() === "content-type") {\n        return headers[key] || "application/octet-stream";\n      }\n    }\n    return "application/octet-stream";\n  };\n  const toDataUrl = (record, fallbackType) => {\n    if (!record) return "";\n    const contentType = getContentType(record) || fallbackType || "application/octet-stream";\n    if (record.responseEncoding === "base64" && record.responseBodyBase64) {\n      return "data:" + contentType + ";base64," + record.responseBodyBase64;\n    }\n    if (record.responseBody) {\n      return "data:" + contentType + ";base64," + textToBase64(record.responseBody);\n    }\n    return "data:" + (fallbackType || "application/octet-stream") + ",";\n  };\n  const responseFromRecord = (record) => {\n    const headers = new Headers(record.responseHeaders || {});\n    if (record.responseEncoding === "base64" && record.responseBodyBase64) {\n      const bytes = decodeBase64(record.responseBodyBase64);\n      return new Response(bytes, {\n        status: record.status || 200,\n        statusText: record.statusText || "OK",\n        headers\n      });\n    }\n    const bodyText = record.responseBody || "";\n    return new Response(bodyText, {\n      status: record.status || 200,\n      statusText: record.statusText || "OK",\n      headers\n    });\n  };\n  const originalFetch = window.fetch.bind(window);\n  window.fetch = async (input, init = {}) => {\n    const url = typeof input === "string" ? input : input.url;\n    const method = (init && init.method) || (typeof input === "string" ? "GET" : input.method || "GET");\n    const body = init && init.body;\n    const record = findRecord(method, url, body);\n    if (record) {\n      return responseFromRecord(record);\n    }\n    return new Response("", { status: 404, statusText: "Not Found" });\n  };\n  const originalOpen = XMLHttpRequest.prototype.open;\n  const originalSend = XMLHttpRequest.prototype.send;\n  XMLHttpRequest.prototype.open = function(method, url, ...rest) {\n    this.__websnapMethod = method;\n    this.__websnapUrl = url;\n    return originalOpen.call(this, method, url, ...rest);\n  };\n  XMLHttpRequest.prototype.send = function(body) {\n    const method = this.__websnapMethod || "GET";\n    const url = this.__websnapUrl || "";\n    const record = findRecord(method, url, body);\n    if (record) {\n      const xhr = this;\n      const responseText = record.responseBody || "";\n      const status = record.status || 200;\n      const statusText = record.statusText || "OK";\n      setTimeout(() => {\n        defineProp(xhr, "readyState", 4);\n        defineProp(xhr, "status", status);\n        defineProp(xhr, "statusText", statusText);\n        if (xhr.responseType === "arraybuffer" && record.responseBodyBase64) {\n          const bytes = decodeBase64(record.responseBodyBase64);\n          defineProp(xhr, "response", bytes.buffer);\n          defineProp(xhr, "responseText", "");\n        } else if (xhr.responseType === "blob" && record.responseBodyBase64) {\n          const bytes = decodeBase64(record.responseBodyBase64);\n          defineProp(xhr, "response", new Blob([bytes]));\n          defineProp(xhr, "responseText", "");\n        } else {\n          defineProp(xhr, "response", responseText);\n          defineProp(xhr, "responseText", responseText);\n        }\n        if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange();\n        if (typeof xhr.onload === "function") xhr.onload(new Event("load"));\n        if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));\n        if (xhr.dispatchEvent) {\n          xhr.dispatchEvent(new Event("readystatechange"));\n          xhr.dispatchEvent(new Event("load"));\n          xhr.dispatchEvent(new Event("loadend"));\n        }\n      }, 0);\n      return;\n    }\n    const xhr = this;\n    const status = 404;\n    const statusText = "Not Found";\n    setTimeout(() => {\n      defineProp(xhr, "readyState", 4);\n      defineProp(xhr, "status", status);\n      defineProp(xhr, "statusText", statusText);\n      defineProp(xhr, "response", "");\n      defineProp(xhr, "responseText", "");\n      if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange();\n      if (typeof xhr.onload === "function") xhr.onload(new Event("load"));\n      if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));\n      if (xhr.dispatchEvent) {\n        xhr.dispatchEvent(new Event("readystatechange"));\n        xhr.dispatchEvent(new Event("load"));\n        xhr.dispatchEvent(new Event("loadend"));\n      }\n    }, 0);\n    return;\n  };\n  const transparentGif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";\n  const emptyScript = "data:text/javascript,/*websnap-missing*/";\n  const emptyStyle = "data:text/css,/*websnap-missing*/";\n  const rewriteSrcset = (value) => {\n    if (!value) return value;\n    return value.split(",").map((part) => {\n      const trimmed = part.trim();\n      if (!trimmed) return trimmed;\n      const pieces = trimmed.split(/\s+/, 2);\n      const url = pieces[0];\n      const descriptor = pieces[1];\n      if (isLocalResource(url)) return trimmed;\n      const localPath = findLocalPath(url);\n      if (localPath) {\n        return descriptor ? localPath + " " + descriptor : localPath;\n      }\n      const record = findByUrl(url);\n      const replacement = record ? toDataUrl(record) : transparentGif;\n      return descriptor ? replacement + " " + descriptor : replacement;\n    }).join(", ");\n  };\n  const rewriteElement = (element) => {\n    if (!element || !element.getAttribute) return;\n    const tag = (element.tagName || "").toLowerCase();\n    if (tag === "img" || tag === "source" || tag === "video" || tag === "audio" || tag === "script" || tag === "iframe") {\n      const src = element.getAttribute("src");\n      if (src && !isLocalResource(src) && !src.startsWith("data:") && !src.startsWith("blob:")) {\n        const localPath = findLocalPath(src);\n        if (localPath) {\n          element.setAttribute("src", localPath);\n          return;\n        }\n        const record = findByUrl(src);\n        const fallback = tag === "script" ? emptyScript : transparentGif;\n        element.setAttribute("src", record ? toDataUrl(record) : fallback);\n      }
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

const toAbsoluteUrl = (baseUrl: string, resourceUrl: string) => {
  try {
    return new URL(resourceUrl, baseUrl).toString();
  } catch {
    return resourceUrl;
  }
};

const extractResourceUrls = (html: string, baseUrl: string) => {
  const $ = cheerio.load(html);
  const urls: Array<{ attr: string; element: any }> = [];

  const collect = (selector: string, attr: string) => {
    $(selector).each((_, element) => {
      const value = $(element).attr(attr);
      if (value) {
        urls.push({ attr, element });
      }
    });
  };

  collect("script[src]", "src");
  collect("link[rel=stylesheet][href]", "href");
  collect("link[rel=icon][href]", "href");
  collect("img[src]", "src");
  collect("source[src]", "src");
  collect("video[src]", "src");
  collect("audio[src]", "src");

  const srcsetItems: Array<{ element: any; value: string }> = [];
  $("img[srcset], source[srcset]").each((_, element) => {
    const value = $(element).attr("srcset");
    if (value) {
      srcsetItems.push({ element, value });
    }
  });

  const resourceUrls = urls.map(({ attr, element }) => {
    const value = $(element).attr(attr) || "";
    return {
      attr,
      element,
      url: toAbsoluteUrl(baseUrl, value),
    };
  });

  return { $, resourceUrls, srcsetItems };
};

const extensionFromContentType = (contentType: string | null) => {
  if (!contentType) {
    return "";
  }
  if (contentType.includes("text/css")) return ".css";
  if (contentType.includes("javascript")) return ".js";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/gif")) return ".gif";
  if (contentType.includes("image/svg")) return ".svg";
  if (contentType.includes("font/woff2")) return ".woff2";
  if (contentType.includes("font/woff")) return ".woff";
  return "";
};

const isTextResponse = (contentType: string) => {
  const lowered = contentType.toLowerCase();
  return (
    lowered.startsWith("text/") ||
    lowered.includes("json") ||
    lowered.includes("javascript") ||
    lowered.includes("xml") ||
    lowered.includes("svg") ||
    lowered.includes("html")
  );
};

const downloadResource = async (url: string, outputDir: string) => {
  const response = await fetch(url, { redirect: "follow" });
  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath) || extensionFromContentType(contentType);
  const filename = `${crypto.createHash("sha1").update(url).digest("hex")}${ext}`;
  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, buffer);
  return { outputPath, filename, contentType, size: buffer.length };
};

const buildDataUrlMap = (records: NetworkRecord[]) => {
  const map = new Map<string, string>();
  for (const record of records) {
    if (!record || !record.url || !record.responseBodyBase64) {
      continue;
    }
    const headers = record.responseHeaders || {};
    let contentType = headers["content-type"];
    if (!contentType) {
      for (const key in headers) {
        if (key.toLowerCase() === "content-type") {
          contentType = headers[key];
          break;
        }
      }
    }
    contentType = contentType || "application/octet-stream";
    map.set(
      record.url,
      `data:${contentType};base64,${record.responseBodyBase64}`,
    );
  }
  return map;
};

const rewriteCssUrls = async (
  filePath: string,
  cssUrl: string,
  dataUrlMap: Map<string, string>,
) => {
  const css = await fs.readFile(filePath, "utf-8");
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const rewritten = css.replace(urlPattern, (match, quote, rawUrl) => {
    const trimmed = String(rawUrl || "").trim();
    if (
      !trimmed ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:")
    ) {
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

const main = async () => {
  const [targetUrl] = process.argv.slice(2);
  if (!targetUrl) {
    console.error(usage());
    process.exit(1);
  }

  const preloadPath = path.join(__dirname, "preload.js");
  const preloadScript = await fs.readFile(preloadPath, "utf-8");

  const browser = await puppeteer.launch({
    headless: true,
  });

  const page = await browser.newPage();
  await page.setRequestInterception(true);

  const networkRecords: NetworkRecord[] = [];

  page.on("request", (request) => {
    request.continue().catch(() => undefined);
  });

  page.on("response", async (response) => {
    const request = response.request();
    const url = response.url();
    const headers = response.headers();
    const requestHeaders = request.headers();
    const requestBody = request.postData() || "";
    let responseBody: string | undefined;
    let responseBodyBase64: string | undefined;
    let responseEncoding: "text" | "base64" | undefined;
    let error: string | undefined;

    try {
      const buffer = await response.buffer();
      const contentType = headers["content-type"] || "";
      if (isTextResponse(contentType)) {
        responseBody = buffer.toString("utf-8");
        responseEncoding = "text";
      } else {
        responseBodyBase64 = buffer.toString("base64");
        responseEncoding = "base64";
      }
    } catch (err: any) {
      error = String(err);
    }

    networkRecords.push({
      url,
      method: request.method(),
      requestHeaders,
      requestBody,
      status: response.status(),
      statusText: response.statusText(),
      responseHeaders: headers,
      responseBody,
      responseBodyBase64,
      responseEncoding,
      error,
      timestamp: Date.now(),
    });
  });

  await page.evaluateOnNewDocument(preloadScript);

  let title = "snapshot";
  let html = "";
  let fetchXhrRecords: FetchRecord[] = [];

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("body", { timeout: 15000 });
    await page
      .waitForNetworkIdle({ idleTime: 2000, timeout: 30000 })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (response) {
      html = await response.text();
    }
    if (!html) {
      html = await page.content();
    }
    const $initial = cheerio.load(html);
    title = $initial("title").first().text() || "snapshot";
    fetchXhrRecords = await page.evaluate(() => {
      return (window as any).__websnapRecords || [];
    });
  } finally {
    await page.close();
    await browser.close();
  }

  const safeTitle = safeFilename(title || "snapshot");
  const outputHtmlPath = path.resolve(`${safeTitle}.html`);
  const outputRequestsPath = path.resolve(`${safeTitle}.requests.json`);
  const resourcesDir = path.resolve(`${safeTitle}_files`);
  await fs.mkdir(resourcesDir, { recursive: true });

  const dataUrlMap = buildDataUrlMap(networkRecords);
  const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, targetUrl);
  const resourceMap = new Map<string, string>();
  const resourceMeta: SnapshotData["resources"] = [];

  for (const resource of resourceUrls) {
    const url = resource.url;
    if (!url || resourceMap.has(url)) {
      continue;
    }
    try {
      const { filename, contentType, size, outputPath } =
        await downloadResource(url, resourcesDir);
      if (
        (contentType && contentType.includes("text/css")) ||
        outputPath.endsWith(".css")
      ) {
        await rewriteCssUrls(outputPath, url, dataUrlMap);
      }
      resourceMap.set(url, filename);
      resourceMeta.push({
        url,
        localPath: path.join(`${safeTitle}_files`, filename),
        contentType,
        size,
      });
    } catch {
      continue;
    }
  }

  for (const resource of resourceUrls) {
    const local = resourceMap.get(resource.url);
    if (!local) {
      continue;
    }
    $(resource.element).attr(
      resource.attr,
      path.join(`${safeTitle}_files`, local),
    );
  }

  for (const item of srcsetItems) {
    const parts = item.value.split(",").map((part) => part.trim());
    const rewritten = parts
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        const absolute = toAbsoluteUrl(targetUrl, url);
        const local = resourceMap.get(absolute);
        if (!local) {
          return part;
        }
        const nextUrl = path.join(`${safeTitle}_files`, local);
        return descriptor ? `${nextUrl} ${descriptor}` : nextUrl;
      })
      .join(", ");
    $(item.element).attr("srcset", rewritten);
  }

  const snapshotData: SnapshotData = {
    url: targetUrl,
    title,
    capturedAt: new Date().toISOString(),
    fetchXhrRecords,
    networkRecords,
    resources: resourceMeta,
  };

  const replayScript = buildReplayScript(snapshotData, targetUrl);
  const head = $("head");
  if (head.length) {
    head.prepend(replayScript);
  } else {
    $.root().prepend(replayScript);
  }

  await fs.writeFile(
    outputRequestsPath,
    JSON.stringify(snapshotData, null, 2),
    "utf-8",
  );
  await fs.writeFile(outputHtmlPath, $.html(), "utf-8");

  console.log(`Saved ${outputHtmlPath}`);
  console.log(`Saved ${outputRequestsPath}`);
  console.log(`Saved resources to ${resourcesDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
