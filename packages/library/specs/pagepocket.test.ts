import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { PagePocket } from "../src/pagepocket";
import type { SnapshotData } from "../src/types";

let originalCwd = "";
let tempDir = "";

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pagepocket-put-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("PagePocket.put parses request JSON strings and returns rewritten HTML", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" }
    });
  };

  try {
    const html = `
      <html>
        <head></head>
        <body>
          <img id="logo" src="/logo.png" />
        </body>
      </html>
    `;

    const snapshot: SnapshotData = {
      url: "https://example.com",
      title: "Example",
      capturedAt: new Date().toISOString(),
      fetchXhrRecords: [],
      networkRecords: [],
      resources: []
    };

    const pagepocket = new PagePocket(html, JSON.stringify(snapshot), {
      assetsDirName: "assets",
      baseUrl: "https://example.com",
      requestsPath: "snapshot.requests.json"
    });

    const output = await pagepocket.put();

    assert.ok(output.includes("/assets/"));
    assert.equal(pagepocket.resources.length, 1);
    assert.equal(pagepocket.downloadedCount, 1);
    assert.equal(pagepocket.failedCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
