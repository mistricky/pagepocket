import type { ScriptHacker } from "./types";

export const replayFetchResponder: ScriptHacker = {
  id: "replay-fetch-responder",
  stage: "replay",
  build: () => `
  // Patch fetch to serve from recorded network data.
   const originalFetch = (typeof __pagepocketOriginalFetch === "function")
    ? __pagepocketOriginalFetch
    : window.fetch.bind(window);
   window.fetch = async (input, init = {}) => {
    if (ready && typeof ready.then === "function") {
      await ready;
    }
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || (typeof input === "string" ? "GET" : input.method || "GET");
    const body = init && init.body;
    try {
      const record = findRecord(method, url, body);
      if (record) {
        return responseFromRecord(record);
      }
    } catch (err) {
      console.warn("pagepocket fetch replay fallback", { url, method, err });
    }
    return new Response("", { status: 404, statusText: "Not Found" });
  };
  window.fetch.__pagepocketOriginal = originalFetch;
  ensureReplayPatches && ensureReplayPatches();

`
};
