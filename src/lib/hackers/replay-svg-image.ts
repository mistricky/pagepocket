import type { ScriptHacker } from "./types";

export const replaySvgImageRewriter: ScriptHacker = {
  id: "replay-svg-image-rewriter",
  stage: "replay",
  build: () => `
  (function(){
    const xlinkNs = "http://www.w3.org/1999/xlink";
    const transparentGif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    let readyResolved = false;
    if (ready && typeof ready.then === "function") {
      ready.then(() => {
        readyResolved = true;
      });
    } else {
      readyResolved = true;
    }

    const onReady = (callback) => {
      if (readyResolved) {
        callback();
        return;
      }
      if (ready && typeof ready.then === "function") {
        ready.then(callback);
      } else {
        callback();
      }
    };

    const resolveHref = (value) => {
      if (!value) return null;
      if (isLocalResource(value)) return value;
      const localPath = findLocalPath(value);
      if (localPath) return localPath;
      const record = findByUrl(value);
      if (record) return toDataUrl(record);
      return transparentGif;
    };

    const rewriteImage = (el) => {
      if (!el || !el.getAttribute) return;
      const href = el.getAttribute("href") || (el.getAttributeNS && el.getAttributeNS(xlinkNs, "href"));
      if (!href) return;
      if (href.startsWith("data:") || href.startsWith("blob:") || isLocalResource(href)) return;
      if (!readyResolved) {
        try { el.setAttributeNS(xlinkNs, "href", transparentGif); } catch {}
        try { el.setAttribute("href", transparentGif); } catch {}
        onReady(() => rewriteImage(el));
        return;
      }
      const next = resolveHref(href);
      if (!next) return;
      try { el.setAttributeNS(xlinkNs, "href", next); } catch {}
      try { el.setAttribute("href", next); } catch {}
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target && mutation.target.tagName && mutation.target.tagName.toLowerCase() === "image") {
          rewriteImage(mutation.target);
        }
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node && node.nodeType === 1) {
              if ((node.tagName || "").toLowerCase() === "image") {
                rewriteImage(node);
              }
              const descendants = node.querySelectorAll ? node.querySelectorAll("image") : [];
              descendants.forEach((img) => rewriteImage(img));
            }
          });
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["href", "xlink:href"]
    });

    document.querySelectorAll("image").forEach((el) => rewriteImage(el));
  })();
  `
};
