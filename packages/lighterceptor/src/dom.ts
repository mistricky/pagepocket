import { JSDOM, VirtualConsole, type DOMWindow } from "jsdom";
import {
  configMocks,
  mockAnimationsApi,
  mockCSSTypedOM,
  mockIntersectionObserver,
  mockResizeObserver,
  mockViewport
} from "jsdom-testing-mocks";

import { InterceptingResourceLoader } from "./resource-loader.js";
import type { RequestInterceptor } from "./types.js";

export type InterceptorOptions = {
  html: string;
  domOptions?: ConstructorParameters<typeof JSDOM>[1];
  interceptor: RequestInterceptor;
};

type GlobalWithHooks = typeof globalThis & {
  beforeAll?: (callback: () => void) => void;
  afterAll?: (callback: () => void) => void;
  beforeEach?: (callback: () => void) => void;
  afterEach?: (callback: () => void) => void;
};

class IntersectionObserverEntryStub implements IntersectionObserverEntry {
  readonly boundingClientRect: DOMRectReadOnly;
  readonly intersectionRatio: number;
  readonly intersectionRect: DOMRectReadOnly;
  readonly isIntersecting: boolean;
  readonly rootBounds: DOMRectReadOnly | null;
  readonly target: Element;
  readonly time: number;

  constructor(
    target: Element,
    boundingClientRect: DOMRectReadOnly,
    intersectionRect: DOMRectReadOnly,
    intersectionRatio: number,
    rootBounds: DOMRectReadOnly | null,
    time: number,
    isIntersecting = intersectionRatio > 0
  ) {
    this.boundingClientRect = boundingClientRect;
    this.intersectionRect = intersectionRect;
    this.intersectionRatio = intersectionRatio;
    this.isIntersecting = isIntersecting;
    this.rootBounds = rootBounds;
    this.target = target;
    this.time = time;
  }
}

const installJsdomTestingMocks = (window: DOMWindow) => {
  const globalWithHooks = globalThis as GlobalWithHooks;
  const noopHook = () => {};

  configMocks({
    beforeAll: globalWithHooks.beforeAll ?? noopHook,
    afterAll: globalWithHooks.afterAll ?? noopHook,
    beforeEach: globalWithHooks.beforeEach ?? noopHook,
    afterEach: globalWithHooks.afterEach ?? noopHook,
    act: (trigger) => trigger()
  });

  const previousGlobals: Record<string, unknown> = {};
  const setGlobal = (key: string, value: unknown) => {
    previousGlobals[key] = (globalThis as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = value;
  };
  const restoreGlobals = () => {
    const preserveIfUndefined = new Set(["DOMRectReadOnly", "DOMRect"]);
    for (const key of Object.keys(previousGlobals)) {
      const value = previousGlobals[key];
      if (value === undefined) {
        if (preserveIfUndefined.has(key)) {
          continue;
        }
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        (globalThis as Record<string, unknown>)[key] = value;
      }
    }
  };

  try {
    setGlobal("window", window);
    setGlobal("document", window.document);
    setGlobal("Element", window.Element);
    setGlobal("Document", window.Document);
    setGlobal("HTMLElement", window.HTMLElement);
    setGlobal("Event", window.Event);
    setGlobal("DOMRect", window.DOMRect);
    setGlobal("DOMRectReadOnly", window.DOMRectReadOnly);
    setGlobal("performance", window.performance);

    if (typeof window.matchMedia !== "function") {
      mockViewport({ width: "1024px", height: "768px" });
    }
    if (typeof window.IntersectionObserver !== "function") {
      mockIntersectionObserver();
    }
    if (typeof window.IntersectionObserverEntry !== "function") {
      window.IntersectionObserverEntry = IntersectionObserverEntryStub;
    }
    if (typeof window.ResizeObserver !== "function") {
      mockResizeObserver();
    }
    if (typeof window.Element?.prototype.animate !== "function") {
      mockAnimationsApi();
    }
    if (typeof (window as { CSS?: unknown }).CSS === "undefined") {
      mockCSSTypedOM();
      const cssGlobals = [
        "CSS",
        "CSSNumericValue",
        "CSSUnitValue",
        "CSSMathValue",
        "CSSMathSum",
        "CSSMathProduct",
        "CSSMathNegate",
        "CSSMathInvert",
        "CSSMathMin",
        "CSSMathMax",
        "CSSMathClamp"
      ];
      for (const key of cssGlobals) {
        const value = (globalThis as Record<string, unknown>)[key];
        if (value) {
          (window as Record<string, unknown>)[key] = value;
        }
      }
    }
  } finally {
    restoreGlobals();
  }
};

export function createJSDOMWithInterceptor(options: InterceptorOptions) {
  const resources = new InterceptingResourceLoader(options.interceptor);
  const domOptions = options.domOptions ?? {};
  const userBeforeParse = domOptions.beforeParse;
  const virtualConsole =
    domOptions.virtualConsole ??
    (() => {
      const consoleShim = new VirtualConsole();
      consoleShim.on("jsdomError", () => {});
      return consoleShim;
    })();

  const dom = new JSDOM(options.html, {
    ...domOptions,
    virtualConsole,
    resources,
    beforeParse(window: DOMWindow) {
      if (userBeforeParse) {
        userBeforeParse(window);
      }

      installJsdomTestingMocks(window);

      if (typeof window.matchMedia !== "function") {
        window.matchMedia = (query: string) =>
          ({
            matches: false,
            media: String(query),
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
          }) as MediaQueryList;
      }

      if (typeof window.CanvasRenderingContext2D !== "function") {
        class CanvasRenderingContext2DStub {}
        window.CanvasRenderingContext2D =
          CanvasRenderingContext2DStub as typeof CanvasRenderingContext2D;
      }

      const scrollState = { x: 0, y: 0 };
      const applyScroll = (x: number, y: number) => {
        scrollState.x = Number.isFinite(x) ? x : scrollState.x;
        scrollState.y = Number.isFinite(y) ? y : scrollState.y;
        (window as unknown as { pageXOffset: number }).pageXOffset = scrollState.x;
        (window as unknown as { pageYOffset: number }).pageYOffset = scrollState.y;
        if (window.document.documentElement) {
          window.document.documentElement.scrollLeft = scrollState.x;
          window.document.documentElement.scrollTop = scrollState.y;
        }
        if (window.document.body) {
          window.document.body.scrollLeft = scrollState.x;
          window.document.body.scrollTop = scrollState.y;
        }
        window.dispatchEvent(new window.Event("scroll"));
      };

      const scrollByImpl: typeof window.scrollBy = (
        left?: number | ScrollToOptions,
        top?: number
      ) => {
        if (typeof left === "object" && left !== null) {
          const { left: targetLeft, top: targetTop } = left;
          applyScroll(scrollState.x + (targetLeft ?? 0), scrollState.y + (targetTop ?? 0));
          return;
        }
        applyScroll(scrollState.x + (left ?? 0), scrollState.y + (top ?? 0));
      };
      const scrollToImpl: typeof window.scrollTo = (
        left?: number | ScrollToOptions,
        top?: number
      ) => {
        if (typeof left === "object" && left !== null) {
          const { left: targetLeft, top: targetTop } = left;
          applyScroll(targetLeft ?? scrollState.x, targetTop ?? scrollState.y);
          return;
        }
        applyScroll((left as number | undefined) ?? scrollState.x, top ?? scrollState.y);
      };
      window.scrollBy = scrollByImpl;
      window.scrollTo = scrollToImpl;

      if (window.HTMLCanvasElement?.prototype) {
        const canvasProto = window.HTMLCanvasElement.prototype;
        canvasProto.getContext = function getContext(type?: string) {
          const normalized = String(type ?? "").toLowerCase();
          if (normalized === "2d" || normalized === "bitmaprenderer") {
            return new window.CanvasRenderingContext2D();
          }

          const glState = {
            program: {},
            shader: {}
          };

          const glStub = new Proxy(
            {},
            {
              get: (_target, prop) => {
                if (prop === "canvas") {
                  return this;
                }
                if (prop === "drawingBufferWidth" || prop === "drawingBufferHeight") {
                  return 0;
                }
                if (prop === "getExtension") {
                  return () => null;
                }
                if (prop === "getContextAttributes") {
                  return () => ({});
                }
                if (prop === "getShaderInfoLog" || prop === "getProgramInfoLog") {
                  return () => "";
                }
                if (prop === "getShaderParameter" || prop === "getProgramParameter") {
                  return () => true;
                }
                if (prop === "createShader") {
                  return () => glState.shader;
                }
                if (prop === "createProgram") {
                  return () => glState.program;
                }
                if (
                  prop === "shaderSource" ||
                  prop === "compileShader" ||
                  prop === "attachShader" ||
                  prop === "linkProgram" ||
                  prop === "useProgram"
                ) {
                  return () => undefined;
                }
                if (prop === "getAttribLocation") {
                  return () => 0;
                }
                if (prop === "getUniformLocation") {
                  return () => ({});
                }
                if (typeof prop === "string" && prop === prop.toUpperCase()) {
                  return 0;
                }
                return () => null;
              }
            }
          );

          return glStub as unknown as RenderingContext;
        };
      }

      const extractCssUrls = (cssText: string) => {
        const urls: string[] = [];
        const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(cssText)) !== null) {
          const url = match[2].trim();
          if (url.length > 0) {
            urls.push(url);
          }
        }

        const importPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?/gi;
        while ((match = importPattern.exec(cssText)) !== null) {
          const url = match[2].trim();
          if (url.length > 0) {
            urls.push(url);
          }
        }

        return urls;
      };

      const interceptCssText = (cssText: string) => {
        for (const url of extractCssUrls(cssText)) {
          void Promise.resolve(
            options.interceptor(url, {
              element: undefined,
              referrer: window.document.URL,
              source: "css"
            })
          );
        }
      };

      const interceptImgSrc = (url: string, element: Element | null) => {
        const imageElement = element instanceof window.HTMLImageElement ? element : undefined;

        void Promise.resolve(
          options.interceptor(url, {
            element: imageElement,
            referrer: window.document.URL,
            source: "img"
          })
        );
      };

      const interceptResourceSrc = (url: string, element?: Element | null) => {
        const iframeOrLink =
          element instanceof window.HTMLIFrameElement
            ? element
            : element instanceof window.HTMLLinkElement
              ? element
              : undefined;

        void Promise.resolve(
          options.interceptor(url, {
            element: iframeOrLink,
            referrer: window.document.URL,
            source: "resource"
          })
        );
      };

      const parseSrcsetUrls = (value: string) => {
        return value
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter((url) => url.length > 0);
      };

      const interceptSrcset = (value: string, element: Element | null) => {
        const isImage = element instanceof window.HTMLImageElement;
        const source = isImage ? "img" : "resource";

        for (const url of parseSrcsetUrls(value)) {
          void Promise.resolve(
            options.interceptor(url, {
              element: isImage ? (element as HTMLImageElement) : undefined,
              referrer: window.document.URL,
              source
            })
          );
        }
      };

      const patchSrcProperty = (
        proto: object | undefined,
        sourceHandler: (value: string, element: Element | null) => void
      ) => {
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "src") : undefined;
        if (proto && descriptor?.set) {
          Object.defineProperty(proto, "src", {
            ...descriptor,
            set(value: string) {
              sourceHandler(String(value), this as Element);
              descriptor.set?.call(this, value);
            }
          });
        }
      };

      const patchSrcsetProperty = (proto: object | undefined) => {
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "srcset") : undefined;
        if (proto && descriptor?.set) {
          Object.defineProperty(proto, "srcset", {
            ...descriptor,
            set(value: string) {
              interceptSrcset(String(value), this as Element);
              descriptor.set?.call(this, value);
            }
          });
        }
      };

      const shouldInterceptLinkRel = (rel: string) => {
        const normalized = rel.toLowerCase();
        return (
          normalized.includes("preload") ||
          normalized.includes("prefetch") ||
          normalized.includes("stylesheet") ||
          normalized.includes("icon")
        );
      };

      const interceptLinkHref = (link: HTMLLinkElement, rel: string) => {
        if (shouldInterceptLinkRel(rel) && link.href) {
          interceptResourceSrc(link.href, link);
        }
      };

      const interceptLinkImagesrcset = (link: HTMLLinkElement) => {
        const rel = (link.getAttribute("rel") ?? "").toLowerCase();
        if (!rel.includes("preload")) {
          return;
        }
        const imagesrcset = link.getAttribute("imagesrcset");
        if (!imagesrcset) {
          return;
        }
        for (const url of parseSrcsetUrls(imagesrcset)) {
          interceptResourceSrc(url, link);
        }
      };

      const patchAttributeProperty = (
        proto: object | undefined,
        property: string,
        sourceHandler: (value: string, element: Element | null) => void
      ) => {
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, property) : undefined;
        if (proto && descriptor?.set) {
          Object.defineProperty(proto, property, {
            ...descriptor,
            set(value: string) {
              sourceHandler(String(value), this as Element);
              descriptor.set?.call(this, value);
            }
          });
        }
      };
      const imgProto = window.HTMLImageElement?.prototype;
      const srcDescriptor = imgProto ? Object.getOwnPropertyDescriptor(imgProto, "src") : undefined;

      if (imgProto && srcDescriptor?.set) {
        Object.defineProperty(imgProto, "src", {
          ...srcDescriptor,
          set(value: string) {
            interceptImgSrc(String(value), this as Element);
            srcDescriptor.set?.call(this, value);
          }
        });
      }

      patchSrcsetProperty(imgProto);
      patchSrcProperty(window.HTMLIFrameElement?.prototype, interceptResourceSrc);
      patchSrcProperty(window.HTMLMediaElement?.prototype, interceptResourceSrc);
      patchSrcProperty(window.HTMLSourceElement?.prototype, interceptResourceSrc);
      patchSrcsetProperty(window.HTMLSourceElement?.prototype);
      patchAttributeProperty(window.HTMLVideoElement?.prototype, "poster", interceptResourceSrc);
      patchAttributeProperty(window.HTMLObjectElement?.prototype, "data", interceptResourceSrc);
      patchSrcProperty(window.HTMLTrackElement?.prototype, interceptResourceSrc);
      patchSrcProperty(window.HTMLEmbedElement?.prototype, interceptResourceSrc);

      const originalSetAttribute = window.Element.prototype.setAttribute;
      window.Element.prototype.setAttribute = function setAttribute(name: string, value: string) {
        if (this instanceof window.HTMLImageElement && name.toLowerCase() === "src") {
          interceptImgSrc(String(value), this);
        }
        if (this instanceof window.HTMLImageElement && name.toLowerCase() === "srcset") {
          interceptSrcset(String(value), this);
        }
        if (
          (this instanceof window.HTMLIFrameElement ||
            this instanceof window.HTMLVideoElement ||
            this instanceof window.HTMLAudioElement ||
            this instanceof window.HTMLSourceElement) &&
          name.toLowerCase() === "src"
        ) {
          interceptResourceSrc(String(value), this);
        }
        if (this instanceof window.HTMLTrackElement && name.toLowerCase() === "src") {
          interceptResourceSrc(String(value), this);
        }
        if (this instanceof window.HTMLEmbedElement && name.toLowerCase() === "src") {
          interceptResourceSrc(String(value), this);
        }
        if (this instanceof window.HTMLObjectElement && name.toLowerCase() === "data") {
          interceptResourceSrc(String(value), this);
        }
        if (this instanceof window.HTMLVideoElement && name.toLowerCase() === "poster") {
          interceptResourceSrc(String(value), this);
        }
        if (this instanceof window.HTMLSourceElement && name === "srcset") {
          interceptSrcset(String(value), this);
        }
        if (this instanceof window.HTMLLinkElement) {
          const lowerName = name.toLowerCase();
          if (lowerName === "href") {
            const rel = (this.getAttribute("rel") ?? "").toLowerCase();
            if (shouldInterceptLinkRel(rel)) {
              interceptResourceSrc(String(value), this);
            }
          }
          if (lowerName === "rel") {
            const rel = String(value).toLowerCase();
            interceptLinkHref(this, rel);
            interceptLinkImagesrcset(this);
          }
          if (lowerName === "imagesrcset") {
            interceptLinkImagesrcset(this);
          }
        }
        if (name.toLowerCase() === "style") {
          interceptCssText(String(value));
        }
        return originalSetAttribute.call(this, name, value);
      };

      const styleProto = window.CSSStyleDeclaration?.prototype;
      const originalSetProperty = styleProto?.setProperty;
      if (styleProto && originalSetProperty) {
        styleProto.setProperty = function setProperty(
          propertyName: string,
          value: string | null,
          priority?: string
        ) {
          if (typeof value === "string") {
            interceptCssText(value);
          }
          return originalSetProperty.call(this, propertyName, value, priority);
        };

        const cssTextDescriptor = Object.getOwnPropertyDescriptor(styleProto, "cssText");
        if (cssTextDescriptor?.set) {
          Object.defineProperty(styleProto, "cssText", {
            ...cssTextDescriptor,
            set(value: string) {
              interceptCssText(String(value));
              cssTextDescriptor.set?.call(this, value);
            }
          });
        }
      }

      const nodeProto = window.Node?.prototype;
      const textContentDescriptor = nodeProto
        ? Object.getOwnPropertyDescriptor(nodeProto, "textContent")
        : undefined;
      if (nodeProto && textContentDescriptor?.set) {
        Object.defineProperty(nodeProto, "textContent", {
          ...textContentDescriptor,
          set(value: string) {
            if (this instanceof window.HTMLStyleElement) {
              interceptCssText(String(value));
            }
            textContentDescriptor.set?.call(this, value);
          }
        });
      }

      const interceptRequest = (url: string, source: "fetch" | "xhr") => {
        void Promise.resolve(
          options.interceptor(url, {
            element: undefined,
            referrer: window.document.URL,
            source
          })
        );
      };

      if (typeof window.fetch === "function") {
        const originalFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          let url = "";

          if (typeof input === "string") {
            url = input;
          } else if (input instanceof URL) {
            url = input.toString();
          } else if ("url" in input) {
            url = String(input.url);
          }

          if (url) {
            interceptRequest(url, "fetch");
          }

          return originalFetch(input, init);
        }) as typeof window.fetch;
      }

      const xhrProto = window.XMLHttpRequest?.prototype;
      if (xhrProto) {
        const originalOpen = xhrProto.open;
        const originalSend = xhrProto.send;

        xhrProto.open = function open(
          this: XMLHttpRequest,
          method: string,
          url: string,
          async?: boolean,
          username?: string | null,
          password?: string | null
        ) {
          (this as XMLHttpRequest & { _interceptorUrl?: string })._interceptorUrl = String(url);
          return originalOpen.call(
            this,
            method,
            url,
            async ?? true,
            username ?? null,
            password ?? null
          );
        };

        xhrProto.send = function send(
          this: XMLHttpRequest,
          body?: Document | XMLHttpRequestBodyInit | null
        ) {
          const { _interceptorUrl } = this as XMLHttpRequest & {
            _interceptorUrl?: string;
          };
          if (_interceptorUrl) {
            interceptRequest(_interceptorUrl, "xhr");
          }
          return originalSend.call(this, body ?? null);
        };
      }
    }
  });

  scanDocumentRequests(dom.window, options.interceptor);
  triggerHoverSweep(dom.window);
  triggerScrollSweep(dom.window);

  return dom;
}

function triggerHoverSweep(window: DOMWindow) {
  const fire = () => {
    const eventInit: EventInit = { bubbles: true, cancelable: true };
    window.document.querySelectorAll("*").forEach((element) => {
      element.dispatchEvent(new window.Event("mouseover", eventInit));
      element.dispatchEvent(new window.Event("mouseenter", eventInit));
    });
  };

  if (window.document.readyState === "complete") {
    fire();
    return;
  }

  window.addEventListener("load", fire, { once: true });
  window.setTimeout(fire, 0);
}

function triggerScrollSweep(window: DOMWindow) {
  const fire = () => {
    const documentElement = window.document.documentElement;
    const body = window.document.body;
    const scrollHeight = Math.max(documentElement?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
    const viewportHeight = window.innerHeight ?? 0;
    const targetY = Math.max(0, scrollHeight - viewportHeight);
    const steps = Math.max(1, Math.min(8, Math.ceil(targetY / 800)));

    window.scrollTo(0, 0);
    for (let step = 1; step <= steps; step += 1) {
      const y = Math.round((targetY * step) / steps);
      window.setTimeout(() => {
        window.scrollTo(0, y);
      }, step * 25);
    }
  };

  if (window.document.readyState === "complete") {
    fire();
    return;
  }

  window.addEventListener("load", fire, { once: true });
  window.setTimeout(fire, 0);
}

function scanDocumentRequests(window: DOMWindow, interceptor: RequestInterceptor) {
  const { document } = window;
  const referrer = document.URL;

  const record = (
    url: string,
    source: "resource" | "img",
    element?: HTMLImageElement | HTMLIFrameElement | HTMLLinkElement
  ) => {
    void Promise.resolve(
      interceptor(url, {
        element,
        referrer,
        source
      })
    );
  };

  const parseSrcsetUrls = (value: string) => {
    return value
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter((url) => url.length > 0);
  };

  const shouldInterceptLinkRel = (rel: string) => {
    const normalized = rel.toLowerCase();
    return (
      normalized.includes("preload") ||
      normalized.includes("prefetch") ||
      normalized.includes("stylesheet") ||
      normalized.includes("icon")
    );
  };

  document.querySelectorAll("img[src]").forEach((img) => {
    if (img instanceof window.HTMLImageElement && img.src) {
      record(img.src, "img", img);
    }
  });

  document.querySelectorAll("img[srcset]").forEach((img) => {
    if (img instanceof window.HTMLImageElement) {
      for (const url of parseSrcsetUrls(img.getAttribute("srcset") ?? "")) {
        record(url, "img", img);
      }
    }
  });

  document.querySelectorAll("source[src]").forEach((source) => {
    const src = source.getAttribute("src");
    if (src) {
      record(src, "resource");
    }
  });

  document.querySelectorAll("source[srcset]").forEach((source) => {
    const srcset = source.getAttribute("srcset");
    if (srcset) {
      for (const url of parseSrcsetUrls(srcset)) {
        record(url, "resource");
      }
    }
  });

  document.querySelectorAll("script[src]").forEach((script) => {
    if (script instanceof window.HTMLScriptElement && script.src) {
      record(script.src, "resource");
    }
  });

  document.querySelectorAll("iframe[src]").forEach((iframe) => {
    if (iframe instanceof window.HTMLIFrameElement && iframe.src) {
      record(iframe.src, "resource", iframe);
    }
  });

  document.querySelectorAll("video[src], audio[src]").forEach((media) => {
    const src = media.getAttribute("src");
    if (src) {
      record(src, "resource");
    }
  });

  document.querySelectorAll("video[poster]").forEach((video) => {
    const poster = video.getAttribute("poster");
    if (poster) {
      record(poster, "resource");
    }
  });

  document.querySelectorAll("track[src]").forEach((track) => {
    const src = track.getAttribute("src");
    if (src) {
      record(src, "resource");
    }
  });

  document.querySelectorAll("embed[src]").forEach((embed) => {
    const src = embed.getAttribute("src");
    if (src) {
      record(src, "resource");
    }
  });

  document.querySelectorAll("object[data]").forEach((object) => {
    const data = object.getAttribute("data");
    if (data) {
      record(data, "resource");
    }
  });

  document.querySelectorAll("link[rel]").forEach((link) => {
    if (!(link instanceof window.HTMLLinkElement)) {
      return;
    }
    const rel = link.getAttribute("rel") ?? "";
    if (shouldInterceptLinkRel(rel)) {
      const href = link.getAttribute("href") ?? link.href;
      if (href) {
        record(href, "resource", link);
      }
    }

    if (rel.toLowerCase().includes("preload")) {
      const imagesrcset = link.getAttribute("imagesrcset");
      if (imagesrcset) {
        for (const url of parseSrcsetUrls(imagesrcset)) {
          record(url, "resource", link);
        }
      }
    }
  });
}
