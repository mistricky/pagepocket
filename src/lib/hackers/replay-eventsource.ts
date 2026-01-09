import type { HackerModule } from "./types";

export const replayEventSourceStub: HackerModule = {
  id: "replay-eventsource-stub",
  stage: "replay",
  build: () => `
  // Stub EventSource to prevent live network connections.
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
`
};
