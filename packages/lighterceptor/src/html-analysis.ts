import { parseSrcsetUrls, shouldInterceptLinkRel } from "./dependency-utils.js";
import { createJSDOMWithInterceptor } from "./dom.js";
import type { ResourceKind } from "./lighterceptor-model.js";
import type { FetchResult } from "./network-utils.js";
import { inferKindFromElement, inferResourceKindFromUrl, resolveUrl } from "./resource-utils.js";
import type { RequestSource } from "./types.js";

type RecordUrl = (url: string, source: RequestSource | "unknown", baseUrl?: string) => void;
type Enqueue = (url: string, kind?: ResourceKind) => void;

type AnalyzeHtmlOptions = {
  htmlText: string;
  baseUrl?: string;
  captureTitle?: boolean;
  settleTimeMs: number;
  recursive: boolean;
  fetchWithCache: (url: string) => Promise<FetchResult>;
  recordUrl: RecordUrl;
  enqueue: Enqueue;
  recordCssUrls: (cssText: string, baseUrl?: string) => void;
};

export async function analyzeHtml({
  htmlText,
  baseUrl,
  captureTitle = false,
  settleTimeMs,
  recursive,
  fetchWithCache,
  recordUrl,
  enqueue,
  recordCssUrls
}: AnalyzeHtmlOptions) {
  const dom = createJSDOMWithInterceptor({
    html: htmlText,
    domOptions: {
      pretendToBeVisual: true,
      runScripts: "dangerously",
      url: baseUrl,
      beforeParse(window) {
        const createStubResponse = (url: string) => {
          const normalizedUrl = url.toLowerCase();
          const bodyText = normalizedUrl.endsWith("/figma/manifest.json")
            ? JSON.stringify({ figures: [], svgs: [] })
            : normalizedUrl.includes("/features/") && normalizedUrl.endsWith(".json")
              ? JSON.stringify({
                  isDead: true,
                  statistics: {},
                  examples_quantiles: []
                })
              : "";
          const encoder = typeof TextEncoder === "function" ? new TextEncoder() : undefined;
          const buffer = encoder ? encoder.encode(bodyText).buffer : new ArrayBuffer(0);
          const headers =
            typeof window.Headers === "function"
              ? new window.Headers()
              : ({
                  append: () => {},
                  delete: () => {},
                  get: () => null,
                  getSetCookie: () => [],
                  has: () => false,
                  set: () => {},
                  forEach: () => {},
                  keys: () => [][Symbol.iterator](),
                  values: () => [][Symbol.iterator](),
                  entries: () => [][Symbol.iterator](),
                  [Symbol.iterator]: () => [][Symbol.iterator]()
                } as Headers);

          const responseUrl = url;
          const response = {
            ok: true,
            status: 200,
            statusText: "OK",
            headers,
            json: async () => {
              if (!bodyText) {
                return {};
              }
              try {
                return JSON.parse(bodyText) as unknown;
              } catch {
                return {};
              }
            },
            text: async () => bodyText,
            arrayBuffer: async () => buffer,
            clone: () => createStubResponse(responseUrl)
          };

          return response as Response;
        };

        window.fetch = ((input: RequestInfo | URL) => {
          let url = "";
          if (typeof input === "string") {
            url = input;
          } else if (input instanceof URL) {
            url = input.toString();
          } else if ("url" in input) {
            url = String(input.url);
          }
          return Promise.resolve(createStubResponse(url)) as Promise<Response>;
        }) as typeof window.fetch;
        window.XMLHttpRequest.prototype.send = function send() {};
      }
    },
    interceptor: async (url, options) => {
      const resolved = resolveUrl(options.referrer, url);
      if (!resolved) {
        return Buffer.from("");
      }

      const source = options.source ?? "unknown";
      recordUrl(resolved, source);

      const element = options.element as Element | undefined;
      const tagName = element?.tagName?.toLowerCase();
      if (recursive && tagName === "script") {
        const result = await fetchWithCache(resolved);
        if (result.ok && result.buffer) {
          return result.buffer;
        }
      }

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
}
