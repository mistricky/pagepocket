import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { write } from "uni-fs";

import type { DownloadedResource } from "../src/download-resources";
import { extractResourceUrls } from "../src/resources";
import { rewriteLinks } from "../src/rewrite-links";
import type { NetworkRecord } from "../src/types";

let originalCwd = "";
let tempDir = "";

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pagepocket-rewrite-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("rewriteLinks replaces HTML/CSS/module imports with local URLs", async () => {
  const baseUrl = "https://example.com";
  const assetsDirName = "snap_files";

  const html = `
    <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <img id="hero" src="/hero.png" srcset="/hero.png 1x, /hero@2x.png 2x">
        <img id="missing" src="/missing.png">
        <script type="module">
          import app from "/app.js";
          console.log(app);
        </script>
      </body>
    </html>
  `;

  const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, baseUrl);

  const resources = new Map<string, DownloadedResource>([
    [
      "https://example.com/styles.css",
      {
        url: "https://example.com/styles.css",
        filename: "styles",
        extension: "css",
        localPath: "snap_files/styles.css",
        contentType: "text/css",
        size: 10
      }
    ],
    [
      "https://example.com/hero.png",
      {
        url: "https://example.com/hero.png",
        filename: "hero",
        extension: "png",
        localPath: "snap_files/hero.png",
        contentType: "image/png",
        size: 10
      }
    ],
    [
      "https://example.com/hero@2x.png",
      {
        url: "https://example.com/hero@2x.png",
        filename: "hero@2x",
        extension: "png",
        localPath: "snap_files/hero@2x.png",
        contentType: "image/png",
        size: 10
      }
    ],
    [
      "https://example.com/app.js",
      {
        url: "https://example.com/app.js",
        filename: "app",
        extension: "js",
        localPath: "snap_files/app.js",
        contentType: "text/javascript",
        size: 10
      }
    ],
    [
      "https://example.com/bg.png",
      {
        url: "https://example.com/bg.png",
        filename: "bg",
        extension: "png",
        localPath: "snap_files/bg.png",
        contentType: "image/png",
        size: 10
      }
    ]
  ]);

  await write("snap_files/styles", "css", "body{background:url('/bg.png');}");
  await write("snap_files/hero", "png", new Uint8Array([1]));
  await write("snap_files/hero@2x", "png", new Uint8Array([2]));
  await write("snap_files/app", "js", "export default 'ok';");
  await write("snap_files/bg", "png", new Uint8Array([3]));

  const networkRecords: NetworkRecord[] = [];

  await rewriteLinks({
    $,
    resourceUrls,
    srcsetItems,
    baseUrl,
    assetsDirName,
    resourceMap: resources,
    networkRecords
  });

  assert.equal($("img#hero").attr("src"), "/snap_files/hero.png");
  assert.equal($("img#hero").attr("srcset"), "/snap_files/hero.png 1x, /snap_files/hero@2x.png 2x");
  assert.equal($("img#missing").attr("src"), "/missing.png");
  assert.equal($("link[rel=stylesheet]").attr("href"), "/snap_files/styles.css");

  const scriptHtml = $('script[type="module"]').html() || "";
  assert.ok(scriptHtml.includes("/snap_files/app.js"));

  const cssContents = await fs.readFile(path.join(tempDir, "snap_files", "styles.css"), "utf-8");
  assert.ok(cssContents.includes("/snap_files/bg.png"));
});
