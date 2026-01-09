import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyResourceMapToDom,
  downloadResource,
  extractResourceUrls,
  toAbsoluteUrl
} from "../src/lib/resources";

describe("resource helpers", () => {
  test("toAbsoluteUrl resolves relative references", () => {
    assert.equal(
      toAbsoluteUrl("https://example.com/path/", "image.png"),
      "https://example.com/path/image.png"
    );
    assert.equal(
      toAbsoluteUrl("https://example.com/path/", "https://other.com/a.png"),
      "https://other.com/a.png"
    );
  });

  test("extractResourceUrls finds url-bearing elements", () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css">
          <script src="/app.js"></script>
        </head>
        <body>
          <img src="hero.png" srcset="hero.png 1x, hero@2x.png 2x">
          <video src="movie.mp4"></video>
        </body>
      </html>
    `;
    const { resourceUrls, srcsetItems } = extractResourceUrls(html, "https://example.com/");
    const urls = resourceUrls.map((item) => item.url);
    assert.ok(urls.includes("https://example.com/styles.css"));
    assert.ok(urls.includes("https://example.com/app.js"));
    assert.ok(urls.includes("https://example.com/hero.png"));
    assert.ok(urls.includes("https://example.com/movie.mp4"));
    assert.equal(srcsetItems.length, 1);
  });

  test("applyResourceMapToDom rewrites src/srcset/href", () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/styles.css">
        </head>
        <body>
          <img src="hero.png" srcset="hero.png 1x, hero@2x.png 2x">
        </body>
      </html>
    `;
    const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, "https://example.com/");
    const resourceMap = new Map<string, string>([
      ["https://example.com/styles.css", "styles.css"],
      ["https://example.com/hero.png", "hero.png"],
      ["https://example.com/hero@2x.png", "hero@2x.png"]
    ]);

    applyResourceMapToDom(
      $,
      resourceUrls,
      srcsetItems,
      "https://example.com/",
      resourceMap,
      "snapshot_files"
    );

    const updated = $.html();
    assert.ok(updated.includes('href="snapshot_files/styles.css"'));
    assert.ok(updated.includes('src="snapshot_files/hero.png"'));
    assert.ok(
      updated.includes('srcset="snapshot_files/hero.png 1x, snapshot_files/hero@2x.png 2x"')
    );
  });

  test("downloadResource writes fetched content to disk", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = async (_input, init) => {
      const headerValue = init?.headers as Record<string, string> | undefined;
      capturedHeaders = headerValue;
      return new Response("test-body", {
        headers: { "content-type": "text/plain" }
      });
    };

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "webecho-resource-"));
    const { outputPath, filename, contentType, size } = await downloadResource(
      "https://example.com/assets/app.css",
      tempDir,
      "https://example.com/page"
    );

    const saved = await fs.readFile(outputPath, "utf-8");
    assert.ok(filename.endsWith(".css"));
    assert.equal(contentType, "text/plain");
    assert.equal(saved, "test-body");
    assert.equal(size, "test-body".length);
    assert.equal(capturedHeaders?.referer, "https://example.com/page");

    await fs.rm(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });
});
