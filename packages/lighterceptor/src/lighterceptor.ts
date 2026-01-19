import { createJSDOMWithInterceptor } from "./dom.js";
import type { RequestSource } from "./types.js";

export type LighterceptorOptions = {
  settleTimeMs?: number;
  recursion?: boolean;
  requestOnly?: boolean;
  baseUrl?: string;
};

export type RequestRecord = {
  url: string;
  source: RequestSource | "unknown";
  timestamp: number;
};

export type ResponseRecord = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "text" | "base64";
};

export type NetworkRecord = {
  url: string;
  source: RequestSource | "unknown";
  method: string;
  timestamp: number;
  response?: ResponseRecord;
  error?: string;
};

export type LighterceptorResult = {
  title?: string;
  capturedAt: string;
  requests: RequestRecord[];
  networkRecords?: NetworkRecord[];
};

const DEFAULT_SETTLE_MS = 50;

type ResourceKind = "html" | "css" | "js";

type ResourceContent = {
  text: string;
  contentType?: string;
  buffer?: Buffer;
};

type FetchResult = {
  ok: boolean;
  response?: ResponseRecord;
  contentType?: string;
  text?: string;
  buffer?: Buffer;
  error?: string;
};

type CssDependencies = {
  imports: string[];
  urls: string[];
};

type JsDependencies = {
  imports: string[];
  importScripts: string[];
  fetches: string[];
  xhrs: string[];
};

export class Lighterceptor {
  private input: string;
  private options: LighterceptorOptions;

  constructor(input: string, options: LighterceptorOptions = {}) {
    this.input = input;
    this.options = options;
  }

  async run(): Promise<LighterceptorResult> {
    const requests: RequestRecord[] = [];
    const networkRecords: NetworkRecord[] = [];
    const capturedAt = new Date().toISOString();
    const settleTimeMs = this.options.settleTimeMs ?? DEFAULT_SETTLE_MS;
    const recursive = this.options.recursion ?? false;
    const requestOnly = this.options.requestOnly ?? false;
    const baseUrl = this.options.baseUrl;
    const pending: Array<{ url: string; kind?: ResourceKind }> = [];
    const processed = new Set<string>();
    const resourceCache = new Map<string, Promise<ResourceContent | null>>();
    const responseCache = new Map<string, Promise<FetchResult>>();
    const pendingNetwork: Array<Promise<void>> = [];

    const fetchWithCache = (url: string) => {
      const existing = responseCache.get(url);
      if (existing) {
        return existing;
      }
      const promise = (async (): Promise<FetchResult> => {
        if (typeof fetch !== "function") {
          return {
            ok: false,
            error: "fetch-unavailable"
          };
        }

        try {
          const response = await fetch(url);
          const cloned = response.clone();
          const [buffer, text] = await Promise.all([response.arrayBuffer(), cloned.text()]);
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          const bodyEncoding = resolveBodyEncoding(
            response.headers.get("content-type") ?? undefined
          );
          const body =
            bodyEncoding === "base64"
              ? Buffer.from(buffer).toString("base64")
              : decodeText(
                  Buffer.from(buffer),
                  response.headers.get("content-type") ?? undefined,
                  text
                );
          const responseRecord: ResponseRecord = {
            status: response.status,
            statusText: response.statusText,
            headers,
            body,
            bodyEncoding
          };
          return {
            ok: response.ok,
            response: responseRecord,
            contentType: response.headers.get("content-type") ?? undefined,
            text: bodyEncoding === "text" ? body : text,
            buffer: Buffer.from(buffer)
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })();
      responseCache.set(url, promise);
      return promise;
    };

    const recordNetwork = (url: string, source: RequestSource | "unknown") => {
      if (requestOnly || isSkippableUrl(url)) {
        return;
      }
      const task = fetchWithCache(url).then((result) => {
        const record: NetworkRecord = {
          url,
          source,
          method: "GET",
          timestamp: Date.now()
        };
        if (result.response) {
          record.response = result.response;
        }
        if (!result.ok) {
          record.error = result.error ?? "request-failed";
        }
        networkRecords.push(record);
      });
      pendingNetwork.push(task);
    };

    const recordUrl = (url: string, source: RequestSource | "unknown", baseUrl?: string) => {
      const resolved = resolveUrl(baseUrl, url);
      if (!resolved) {
        return;
      }

      requests.push({
        url: resolved,
        source,
        timestamp: Date.now()
      });

      recordNetwork(resolved, source);
    };

    const enqueue = (url: string, kind?: ResourceKind) => {
      if (!recursive || isSkippableUrl(url)) {
        return;
      }
      if (processed.has(url)) {
        return;
      }
      processed.add(url);
      pending.push({ url, kind });
    };

    const recordCssUrls = (cssText: string, baseUrl?: string) => {
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
    };

    const analyzeJs = (jsText: string, baseUrl?: string) => {
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
    };

    const analyzeHtml = async (htmlText: string, baseUrl?: string, captureTitle = false) => {
      const dom = createJSDOMWithInterceptor({
        html: htmlText,
        domOptions: {
          pretendToBeVisual: true,
          runScripts: "dangerously",
          url: baseUrl,
          beforeParse(window) {
            window.fetch = () => Promise.resolve({ ok: true }) as unknown as Promise<Response>;
            window.XMLHttpRequest.prototype.send = function send() {};
          }
        },
        interceptor: (url, options) => {
          const resolved = resolveUrl(options.referrer, url);
          if (!resolved) {
            return Buffer.from("");
          }

          const source = options.source ?? "unknown";
          recordUrl(resolved, source);

          if (recursive) {
            if (source === "fetch" || source === "xhr") {
              enqueue(resolved, inferResourceKindFromUrl(resolved));
            } else if (source === "resource") {
              const kind = inferKindFromElement(options.element);
              if (kind) {
                enqueue(resolved, kind);
              }
            }
          }

          return Buffer.from("");
        }
      });

      const { document } = dom.window;

      document.querySelectorAll("img").forEach((img) => {
        if (img instanceof dom.window.HTMLImageElement && img.src) {
          recordUrl(img.src, "img", baseUrl);
        }
      });

      document.querySelectorAll("img[srcset]").forEach((img) => {
        if (!(img instanceof dom.window.HTMLImageElement)) {
          return;
        }
        const srcset = img.getAttribute("srcset");
        if (!srcset) {
          return;
        }
        for (const url of parseSrcsetUrls(srcset)) {
          recordUrl(url, "img", baseUrl);
        }
      });

      document.querySelectorAll("source[src]").forEach((source) => {
        const src = source.getAttribute("src");
        if (src) {
          recordUrl(src, "resource", baseUrl);
        }
      });

      document.querySelectorAll("source[srcset]").forEach((source) => {
        const srcset = source.getAttribute("srcset");
        if (srcset) {
          for (const url of parseSrcsetUrls(srcset)) {
            recordUrl(url, "resource", baseUrl);
          }
        }
      });

      document.querySelectorAll("script[src]").forEach((script) => {
        if (script instanceof dom.window.HTMLScriptElement && script.src) {
          recordUrl(script.src, "resource", baseUrl);
          enqueue(script.src, "js");
        }
      });

      document.querySelectorAll("iframe[src]").forEach((iframe) => {
        if (iframe instanceof dom.window.HTMLIFrameElement && iframe.src) {
          recordUrl(iframe.src, "resource", baseUrl);
          enqueue(iframe.src, "html");
        }
      });

      document.querySelectorAll("video[src], audio[src]").forEach((media) => {
        const src = media.getAttribute("src");
        if (src) {
          recordUrl(src, "resource", baseUrl);
        }
      });

      document.querySelectorAll("video[poster]").forEach((video) => {
        const poster = video.getAttribute("poster");
        if (poster) {
          recordUrl(poster, "resource", baseUrl);
        }
      });

      document.querySelectorAll("track[src]").forEach((track) => {
        const src = track.getAttribute("src");
        if (src) {
          recordUrl(src, "resource", baseUrl);
        }
      });

      document.querySelectorAll("embed[src]").forEach((embed) => {
        const src = embed.getAttribute("src");
        if (src) {
          recordUrl(src, "resource", baseUrl);
        }
      });

      document.querySelectorAll("object[data]").forEach((object) => {
        const data = object.getAttribute("data");
        if (data) {
          recordUrl(data, "resource", baseUrl);
        }
      });

      document.querySelectorAll("[style]").forEach((element) => {
        const cssText = element.getAttribute("style");
        if (cssText) {
          recordCssUrls(cssText, baseUrl);
        }
      });

      document.querySelectorAll("style").forEach((style) => {
        if (style.textContent) {
          recordCssUrls(style.textContent, baseUrl);
        }
      });

      document.querySelectorAll("link[rel]").forEach((link) => {
        if (!(link instanceof dom.window.HTMLLinkElement)) {
          return;
        }
        const rel = link.getAttribute("rel") ?? "";
        if (shouldInterceptLinkRel(rel)) {
          const href = link.getAttribute("href") ?? link.href;
          if (href) {
            const resolvedHref = resolveUrl(baseUrl, href) ?? href;
            recordUrl(resolvedHref, "resource");
            if (rel.toLowerCase().includes("stylesheet")) {
              enqueue(resolvedHref, "css");
            } else if (rel.toLowerCase().includes("preload")) {
              const kind = inferResourceKindFromUrl(resolvedHref);
              if (kind) {
                enqueue(resolvedHref, kind);
              }
            }
          }
        }
        if (rel.toLowerCase().includes("preload")) {
          const imagesrcset = link.getAttribute("imagesrcset");
          if (imagesrcset) {
            for (const url of parseSrcsetUrls(imagesrcset)) {
              recordUrl(url, "resource", baseUrl);
            }
          }
        }
      });

      await new Promise((resolve) => setTimeout(resolve, settleTimeMs));

      if (captureTitle) {
        return dom.window.document.title || undefined;
      }

      return undefined;
    };

    const loadResource = async (url: string) => {
      const existing = resourceCache.get(url);
      if (existing) {
        return existing;
      }
      const loader = fetchWithCache(url).then((result) => {
        if (!result.ok || !result.text) {
          return null;
        }
        return {
          text: result.text,
          contentType: result.contentType,
          buffer: result.buffer
        };
      });
      resourceCache.set(url, loader);
      return loader;
    };

    const processPending = async () => {
      while (pending.length > 0) {
        const next = pending.shift();
        if (!next) {
          continue;
        }
        const result = await loadResource(next.url);
        if (!result) {
          continue;
        }

        const kind = next.kind ?? detectResourceKind(next.url, result.contentType, result.text);
        if (!kind) {
          continue;
        }

        if (kind === "html") {
          await analyzeHtml(result.text, next.url);
          continue;
        }

        if (kind === "css") {
          recordCssUrls(result.text, next.url);
          continue;
        }

        analyzeJs(result.text, next.url);
      }
    };

    const initialUrl = parseAbsoluteUrl(this.input);
    const effectiveBaseUrl = baseUrl ?? initialUrl ?? undefined;
    let initialInput = this.input;

    if (initialUrl) {
      const result = await fetchWithCache(initialUrl);
      if (!result.ok || !result.text) {
        return {
          title: undefined,
          capturedAt,
          requests,
          networkRecords: requestOnly ? [] : networkRecords
        };
      }
      initialInput = result.text;
    }

    const inputKind = detectInputKind(initialInput);

    let title: string | undefined;
    if (inputKind === "html") {
      title = await analyzeHtml(initialInput, effectiveBaseUrl, true);
    } else if (inputKind === "css") {
      recordCssUrls(initialInput, effectiveBaseUrl);
    } else {
      analyzeJs(initialInput, effectiveBaseUrl);
    }

    await processPending();
    await Promise.allSettled(pendingNetwork);

    return {
      title,
      capturedAt,
      requests,
      networkRecords: requestOnly ? [] : networkRecords
    };
  }
}

function resolveUrl(baseUrl: string | undefined, url: string) {
  if (!url) {
    return undefined;
  }
  if (baseUrl) {
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return url;
    }
  }

  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

function parseAbsoluteUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isSkippableUrl(url: string) {
  const lowered = url.toLowerCase();
  return (
    lowered.startsWith("data:") || lowered.startsWith("javascript:") || lowered.startsWith("about:")
  );
}

function inferResourceKindFromUrl(url: string) {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const extension = cleanUrl.split(".").pop()?.toLowerCase();
  if (!extension) {
    return undefined;
  }
  if (extension === "html" || extension === "htm") {
    return "html";
  }
  if (extension === "css") {
    return "css";
  }
  if (extension === "js" || extension === "mjs" || extension === "cjs") {
    return "js";
  }
  return undefined;
}

function detectResourceKind(url: string, contentType: string | undefined, text: string) {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("text/html")) {
    return "html";
  }
  if (normalized.includes("text/css")) {
    return "css";
  }
  if (normalized.includes("javascript")) {
    return "js";
  }

  const inferred = inferResourceKindFromUrl(url);
  if (inferred) {
    return inferred;
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return "html";
  }
  if (trimmed.startsWith("<")) {
    return "html";
  }
  if (trimmed.startsWith("@") || trimmed.includes("url(")) {
    return "css";
  }
  if (looksLikeJavaScript(trimmed)) {
    return "js";
  }
  return undefined;
}

function detectInputKind(input: string): ResourceKind {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("<")) {
    return "html";
  }
  if (trimmed.startsWith("@") || trimmed.includes("url(")) {
    return "css";
  }
  return "js";
}

function looksLikeJavaScript(text: string) {
  return (
    /\b(import|export)\b/.test(text) ||
    /\b(const|let|var|function)\b/.test(text) ||
    /\bfetch\s*\(/.test(text) ||
    /\bXMLHttpRequest\b/.test(text) ||
    /\bimportScripts\s*\(/.test(text)
  );
}

function inferKindFromElement(element: unknown): ResourceKind | undefined {
  if (!element || typeof element !== "object") {
    return undefined;
  }

  const tagName =
    "tagName" in element && typeof element.tagName === "string"
      ? element.tagName.toLowerCase()
      : "";

  if (tagName === "script") {
    return "js";
  }
  if (tagName === "iframe") {
    return "html";
  }
  if (tagName === "link" && "getAttribute" in element) {
    const rel = String((element as Element).getAttribute("rel") ?? "").toLowerCase();
    const asValue = String((element as Element).getAttribute("as") ?? "").toLowerCase();

    if (rel.includes("stylesheet")) {
      return "css";
    }
    if (rel.includes("preload") || rel.includes("prefetch")) {
      if (asValue === "style") {
        return "css";
      }
      if (asValue === "script") {
        return "js";
      }
    }
  }

  return undefined;
}

function extractCssDependencies(cssText: string): CssDependencies {
  const imports: string[] = [];
  const urls: string[] = [];
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  const importPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?/gi;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(cssText)) !== null) {
    const url = match[2].trim();
    if (url.length > 0) {
      urls.push(url);
    }
  }

  while ((match = importPattern.exec(cssText)) !== null) {
    const url = match[2].trim();
    if (url.length > 0) {
      imports.push(url);
    }
  }

  return { imports, urls };
}

function extractJsDependencies(jsText: string): JsDependencies {
  const imports = new Set<string>();
  const importScripts = new Set<string>();
  const fetches = new Set<string>();
  const xhrs = new Set<string>();

  const importPattern = /\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importScriptsPattern = /\bimportScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
  const fetchPattern = /\bfetch\(\s*['"]([^'"]+)['"]/g;
  const xhrPattern = /\.open\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(jsText)) !== null) {
    imports.add(match[1]);
  }

  while ((match = dynamicImportPattern.exec(jsText)) !== null) {
    imports.add(match[1]);
  }

  while ((match = importScriptsPattern.exec(jsText)) !== null) {
    importScripts.add(match[1]);
  }

  while ((match = fetchPattern.exec(jsText)) !== null) {
    fetches.add(match[1]);
  }

  while ((match = xhrPattern.exec(jsText)) !== null) {
    xhrs.add(match[1]);
  }

  return {
    imports: [...imports],
    importScripts: [...importScripts],
    fetches: [...fetches],
    xhrs: [...xhrs]
  };
}

function parseSrcsetUrls(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((url) => url.length > 0);
}

function shouldInterceptLinkRel(rel: string) {
  const normalized = rel.toLowerCase();
  return (
    normalized.includes("preload") ||
    normalized.includes("prefetch") ||
    normalized.includes("stylesheet") ||
    normalized.includes("icon")
  );
}

function resolveBodyEncoding(contentType: string | undefined) {
  if (!contentType) {
    return "text";
  }
  const normalized = contentType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("svg")
  ) {
    return "text";
  }
  return "base64";
}

function decodeText(buffer: Buffer, contentType: string | undefined, fallback: string) {
  const charset = contentType
    ?.toLowerCase()
    .match(/charset=([^;]+)/)?.[1]
    ?.trim();
  if (!charset) {
    return fallback;
  }
  try {
    const decoder = new TextDecoder(charset);
    return decoder.decode(buffer);
  } catch {
    return fallback;
  }
}
