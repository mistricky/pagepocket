import { preloadHackers } from "./lib/hackers";
import type { HackerContext } from "./lib/hackers/types";

export const buildPreloadScript = () => {
  const context: HackerContext = { stage: "preload" };
  const hackerScripts = preloadHackers
    .map((hacker) => `  // hacker:${hacker.id}\n${hacker.build(context)}`)
    .join("\n");

  return `
(function () {
  if (window.__pagepocketPatched) {
    return;
  }
  Object.defineProperty(window, "__pagepocketPatched", { value: true });

  const records = [];
  window.__pagepocketRecords = records;
  window.__pagepocketPendingRequests = 0;

  const toAbsoluteUrl = (input) => {
    try {
      return new URL(input, window.location.href).toString();
    } catch {
      return input;
    }
  };

  const normalizeBody = (body) => {
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

  const trackPendingStart = () => {
    window.__pagepocketPendingRequests += 1;
  };
  const trackPendingEnd = () => {
    window.__pagepocketPendingRequests = Math.max(0, window.__pagepocketPendingRequests - 1);
  };

${hackerScripts}
})();
`;
};
