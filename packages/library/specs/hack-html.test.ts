import assert from "node:assert/strict";
import { test } from "node:test";

import * as cheerio from "cheerio";

import { hackHtml } from "../src/hack-html";

test("hackHtml injects preload/replay scripts and favicon", () => {
  const $ = cheerio.load("<html><head></head><body></body></html>");

  hackHtml({
    $,
    baseUrl: "https://example.com",
    requestsPath: "snapshot.requests.json",
    faviconDataUrl: "data:image/png;base64,abc"
  });

  const headHtml = $("head").html() || "";
  assert.ok(headHtml.includes("__pagepocketPatched"));
  assert.ok(headHtml.includes("hacker:replay-fetch-responder"));
  assert.ok(headHtml.includes("snapshot.requests.json"));
  assert.ok($('link[rel="icon"]').attr("href") === "data:image/png;base64,abc");
});
