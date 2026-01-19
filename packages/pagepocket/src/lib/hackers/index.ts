import { preloadFetchRecorder } from "./preload-fetch";
import { preloadXhrRecorder } from "./preload-xhr";
import { replayBeaconStub } from "./replay-beacon";
import { replayDomRewriter } from "./replay-dom-rewrite";
import { replayEventSourceStub } from "./replay-eventsource";
import { replayFetchResponder } from "./replay-fetch";
import { replaySvgImageRewriter } from "./replay-svg-image";
import { replayWebSocketStub } from "./replay-websocket";
import { replayXhrResponder } from "./replay-xhr";
import type { ScriptHacker } from "./types";

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
