import type { HackerModule } from "./types";

export const replayWebSocketStub: HackerModule = {
  id: "replay-websocket-stub",
  stage: "replay",
  build: () => `
  // Stub WebSocket to prevent live network connections.
  if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const socket = {
        url,
        readyState: 1,
        send: function() {},
        close: function() {},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
      };
      return socket;
    };
    window.WebSocket.__websnapOriginal = OriginalWebSocket;
  }
`
};
