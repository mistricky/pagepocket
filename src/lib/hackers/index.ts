import type { CaptureContext, CaptureHacker, ScriptHacker } from "./types";
import { captureNetworkRecorder } from "./capture-network";
import { preloadFetchRecorder } from "./preload-fetch";
import { preloadXhrRecorder } from "./preload-xhr";
import { replayFetchResponder } from "./replay-fetch";
import { replayXhrResponder } from "./replay-xhr";
import { replayDomRewriter } from "./replay-dom-rewrite";
import { replayBeaconStub } from "./replay-beacon";
import { replayWebSocketStub } from "./replay-websocket";
import { replayEventSourceStub } from "./replay-eventsource";
import { replaySvgImageRewriter } from "./replay-svg-image";

export const preloadHackers: ScriptHacker[] = [preloadFetchRecorder, preloadXhrRecorder];

export const replayHackers: ScriptHacker[] = [
  replayFetchResponder,
  replayXhrResponder,
  replayDomRewriter,
  replaySvgImageRewriter,
  replayBeaconStub,
  replayWebSocketStub,
  replayEventSourceStub
];

export const captureHackers: CaptureHacker[] = [captureNetworkRecorder];

export const applyCaptureHackers = async (context: CaptureContext) => {
  for (const hacker of captureHackers) {
    await hacker.apply(context);
  }
};
