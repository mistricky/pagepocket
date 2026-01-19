import type { ScriptHacker } from "./types";
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
