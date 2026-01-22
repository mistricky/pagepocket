import type { CheerioAPI } from "cheerio";

import { buildPreloadScript } from "./preload";
import { buildReplayScript } from "./replay-script";

type HackHtmlInput = {
  $: CheerioAPI;
  baseUrl: string;
  requestsPath: string;
  faviconDataUrl?: string | null;
};

export const hackHtml = (input: HackHtmlInput) => {
  const replayScript = buildReplayScript(input.requestsPath, input.baseUrl);
  const preloadScript = `<script>${buildPreloadScript()}</script>`;
  const head = input.$("head");
  const root = input.$.root();

  if (head.length) {
    head.prepend(replayScript);
    head.prepend(preloadScript);
  } else {
    root.prepend(replayScript);
    root.prepend(preloadScript);
  }

  if (input.faviconDataUrl) {
    const existingIcon = input.$('link[rel="icon"]');
    if (existingIcon.length) {
      existingIcon.attr("href", input.faviconDataUrl);
    } else if (head.length) {
      head.append(`<link rel="icon" href="${input.faviconDataUrl}" />`);
    } else {
      root.append(`<link rel="icon" href="${input.faviconDataUrl}" />`);
    }
  }
};
