import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDataUrlMap, rewriteCssUrls } from "../src/lib/css-rewrite";
import type { NetworkRecord } from "../src/lib/types";

describe("css-rewrite", () => {
  test("builds data URL map from network records", () => {
    const records: NetworkRecord[] = [
      {
        url: "https://example.com/asset.png",
        method: "GET",
        responseHeaders: { "Content-Type": "image/png" },
        responseBodyBase64: "AAAB",
        responseEncoding: "base64",
        timestamp: Date.now()
      },
      {
        url: "https://example.com/skip.png",
        method: "GET",
        timestamp: Date.now()
      }
    ];

    const map = buildDataUrlMap(records);
    assert.equal(map.get("https://example.com/asset.png"), "data:image/png;base64,AAAB");
    assert.equal(map.has("https://example.com/skip.png"), false);
  });

  test("rewrites css url() values to data urls", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pagepocket-css-"));
    const cssPath = path.join(tempDir, "styles.css");
    const cssUrl = "https://example.com/styles.css";
    await fs.writeFile(
      cssPath,
      `
      body { background: url("/asset.png"); }
      .logo { background: url('https://example.com/logo.png'); }
      .skip { background: url("data:image/png;base64,abc"); }
      `,
      "utf-8"
    );

    const map = new Map<string, string>([
      ["https://example.com/asset.png", "data:image/png;base64,AAAA"],
      ["https://example.com/logo.png", "data:image/png;base64,BBBB"]
    ]);

    await rewriteCssUrls(cssPath, cssUrl, map);
    const updated = await fs.readFile(cssPath, "utf-8");
    assert.ok(updated.includes("data:image/png;base64,AAAA"));
    assert.ok(updated.includes("data:image/png;base64,BBBB"));
    assert.ok(updated.includes("data:image/png;base64,abc"));

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
