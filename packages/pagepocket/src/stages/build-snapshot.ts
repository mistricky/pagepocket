import path from "node:path";

import type { CheerioAPI } from "cheerio";

import { buildReplayScript } from "../lib/replay-script";
type BuildSnapshotInput = {
  $: CheerioAPI;
  targetUrl: string;
  outputRequestsPath: string;
  faviconDataUrl?: string | null;
};

export const buildSnapshotHtml = (input: BuildSnapshotInput) => {
  const replayScript = buildReplayScript(path.basename(input.outputRequestsPath), input.targetUrl);
  const head = input.$("head");
  if (head.length) {
    head.prepend(replayScript);
  } else {
    input.$.root().prepend(replayScript);
  }

  if (input.faviconDataUrl) {
    const existingIcon = input.$('link[rel="icon"]');
    if (existingIcon.length) {
      existingIcon.attr("href", input.faviconDataUrl);
    } else {
      const link = '<link rel="icon" href="' + input.faviconDataUrl + '" />';
      head.length ? head.append(link) : input.$.root().append(link);
    }
  }

  return input.$.html();
};
