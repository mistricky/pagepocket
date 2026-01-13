import type { ScriptHacker } from "./types";

export const replayXhrResponder: ScriptHacker = {
  id: "replay-xhr-responder",
  stage: "replay",
  build: () => `
  // Patch XHR so app code sees consistent responses offline.
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const waitForReady = () => {
    if (ready && typeof ready.then === "function") {
      return ready;
    }
    return Promise.resolve();
  };
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__pagepocketMethod = method;
    this.__pagepocketUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const method = this.__pagepocketMethod || "GET";
    const url = this.__pagepocketUrl || "";
    const xhr = this;
    waitForReady().then(() => {
      let record = null;
      try {
        record = findRecord(method, url, body);
      } catch (err) {
        console.warn("pagepocket xhr replay fallback", { url, method, err });
      }
      if (record) {
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
    });
    return;
  };
  XMLHttpRequest.prototype.open.__pagepocketOriginal = originalOpen;
  XMLHttpRequest.prototype.send.__pagepocketOriginal = originalSend;
  ensureReplayPatches && ensureReplayPatches();
`
};
