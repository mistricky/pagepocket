import type { ScriptHacker } from "./types";

export const replayBeaconStub: ScriptHacker = {
  id: "replay-beacon-stub",
  stage: "replay",
  build: () => `
  // Stub beacon calls so analytics doesn't leak outside the snapshot.
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      const record = findRecord("POST", url, data);
      if (record) {
        return true;
      }
      return true;
    };
    navigator.sendBeacon.__webechoOriginal = originalBeacon;
  }
`
};
