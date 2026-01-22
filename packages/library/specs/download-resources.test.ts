import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { downloadResources } from "../src/download-resources";
import { extractResourceUrls } from "../src/resources";

let originalCwd = "";
let tempDir = "";

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pagepocket-download-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("downloadResources writes assets via uni-fs and records metadata", async () => {
  const originalFetch = globalThis.fetch;
  let seenReferer: string | undefined;
  globalThis.fetch = async (_input, init) => {
    const headers = (init?.headers || {}) as Record<string, string>;
    seenReferer = headers.referer;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" }
    });
  };

  try {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css">
        </head>
        <body>
          <img src="/logo.png" srcset="/logo.png 1x, /logo@2x.png 2x">
        </body>
      </html>
    `;
    const baseUrl = "https://example.com";
    const { resourceUrls, srcsetItems } = extractResourceUrls(html, baseUrl);

    const result = await downloadResources({
      baseUrl,
      assetsDirName: "assets",
      resourceUrls,
      srcsetItems,
      referer: baseUrl
    });

    assert.equal(result.downloadedCount, 3);
    assert.equal(result.failedCount, 0);
    assert.equal(result.resourceMeta.length, 3);
    assert.equal(seenReferer, baseUrl);

    const files = await fs.readdir(path.join(tempDir, "assets"));
    assert.equal(files.length, 3);
    assert.ok(result.resourceMeta.every((item) => item.localPath.startsWith("assets/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
