import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { write } from "uni-fs";

import { rewriteCssUrls } from "../src/css-rewrite";

describe("css-rewrite", () => {
  test("rewrites css url() values using uni-fs", async () => {
    const originalCwd = process.cwd();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pagepocket-css-"));
    process.chdir(tempDir);

    try {
      const cssUrl = "https://example.com/styles.css";
      await write(
        "assets/styles",
        "css",
        `
        body { background: url("/asset.png"); }
        .logo { background: url('https://example.com/logo.png'); }
        .skip { background: url("data:image/png;base64,abc"); }
        `
      );

      await rewriteCssUrls({
        filename: "assets/styles",
        extension: "css",
        cssUrl,
        resolveUrl: async (absoluteUrl) => {
          if (absoluteUrl === "https://example.com/asset.png") {
            return "/assets/asset.png";
          }
          if (absoluteUrl === "https://example.com/logo.png") {
            return "/assets/logo.png";
          }
          return null;
        }
      });

      const updated = await fs.readFile(path.join(tempDir, "assets", "styles.css"), "utf-8");
      assert.ok(updated.includes("/assets/asset.png"));
      assert.ok(updated.includes("/assets/logo.png"));
      assert.ok(updated.includes("data:image/png;base64,abc"));
    } finally {
      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
