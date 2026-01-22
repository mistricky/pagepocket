import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractResourceUrls, toAbsoluteUrl } from "../src/resources";

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
});
