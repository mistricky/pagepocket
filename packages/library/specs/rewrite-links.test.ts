import assert from "node:assert/strict";
import { test } from "node:test";

import { rewriteEntryHtml } from "../src/rewrite-links";

test("rewriteEntryHtml rewrites HTML attributes, srcset, and module imports", async () => {
  const baseUrl = "https://example.com/page";
  const html = `
    <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <style>.hero { background: url("/bg.png"); }</style>
      </head>
      <body style="background: url('/inline.png')">
        <img id="hero" src="/hero.png" srcset="/hero.png 1x, /hero@2x.png 2x">
        <script type="module">
          import app from "/app.js";
          console.log(app);
        </script>
      </body>
    </html>
  `;

  const resolve = (absoluteUrl: string) => {
    const mapping: Record<string, string> = {
      "https://example.com/styles.css": "/styles.css",
      "https://example.com/bg.png": "/bg.png",
      "https://example.com/inline.png": "/inline.png",
      "https://example.com/hero.png": "/hero.png",
      "https://example.com/hero@2x.png": "/hero@2x.png",
      "https://example.com/app.js": "/app.js"
    };
    return mapping[absoluteUrl] ?? null;
  };

  const rewritten = await rewriteEntryHtml({
    html,
    entryUrl: baseUrl,
    apiPath: "/api.json",
    resolve
  });

  assert.ok(rewritten.html.includes('href="/styles.css"'));
  assert.ok(rewritten.html.includes('src="/hero.png"'));
  assert.ok(rewritten.html.includes("/hero@2x.png 2x"));
  assert.ok(rewritten.html.includes('import app from "/app.js"'));
  assert.ok(rewritten.html.includes("/bg.png"));
  assert.ok(rewritten.html.includes("/inline.png"));
  assert.ok(rewritten.html.includes("/api.json"));
});
