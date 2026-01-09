import type { ScriptHacker } from "./types";

export const replayDomRewriter: ScriptHacker = {
  id: "replay-dom-rewriter",
  stage: "replay",
  build: () => `
  // Placeholder data URLs for missing resources.
  const transparentGif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const emptyScript = "data:text/javascript,/*webecho-missing*/";
  const emptyStyle = "data:text/css,/*webecho-missing*/";

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
`
};
