import type { ScriptHacker } from "./types";

export const replayFetchResponder: ScriptHacker = {
  id: "replay-fetch-responder",
  stage: "replay",
  build: () => `
  // Patch fetch to serve from recorded network data.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || (typeof input === "string" ? "GET" : input.method || "GET");
    const body = init && init.body;
    const record = findRecord(method, url, body);
    if (record) {
      return responseFromRecord(record);
    }
    return new Response("", { status: 404, statusText: "Not Found" });
  };
  window.fetch.__webechoOriginal = originalFetch;
`
};
