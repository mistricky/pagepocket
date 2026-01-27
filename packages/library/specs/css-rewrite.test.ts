import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rewriteCssText } from "../src/css-rewrite";

describe("rewriteCssText", () => {
  test("rewrites url() and @import values to snapshot paths", async () => {
    const cssUrl = "https://example.com/styles.css";
    const original = `
      body { background: url("/asset.png"); }
      .logo { background: url('https://example.com/logo.png'); }
      @import url("/import.css");
      .skip { background: url("data:image/png;base64,abc"); }
    `;

    const rewritten = await rewriteCssText({
      cssText: original,
      cssUrl,
      resolveUrl: async (absoluteUrl) => {
        if (absoluteUrl === "https://example.com/asset.png") {
          return "/assets/asset.png";
        }
        if (absoluteUrl === "https://example.com/logo.png") {
          return "/assets/logo.png";
        }
        if (absoluteUrl === "https://example.com/import.css") {
          return "/assets/import.css";
        }
        return null;
      }
    });

    assert.ok(rewritten.includes("/assets/asset.png"));
    assert.ok(rewritten.includes("/assets/logo.png"));
    assert.ok(rewritten.includes("/assets/import.css"));
    assert.ok(rewritten.includes("data:image/png;base64,abc"));
  });
});
