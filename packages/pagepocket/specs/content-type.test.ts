import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extensionFromContentType, isTextResponse } from "../src/lib/content-type";

describe("content-type helpers", () => {
  test("maps common content types to extensions", () => {
    assert.equal(extensionFromContentType("text/css; charset=utf-8"), ".css");
    assert.equal(extensionFromContentType("application/javascript"), ".js");
    assert.equal(extensionFromContentType("image/png"), ".png");
    assert.equal(extensionFromContentType("image/jpeg"), ".jpg");
    assert.equal(extensionFromContentType("image/gif"), ".gif");
    assert.equal(extensionFromContentType("image/svg+xml"), ".svg");
    assert.equal(extensionFromContentType("font/woff2"), ".woff2");
    assert.equal(extensionFromContentType("font/woff"), ".woff");
  });

  test("returns empty string for unknown or missing types", () => {
    assert.equal(extensionFromContentType("application/octet-stream"), "");
    assert.equal(extensionFromContentType(undefined), "");
    assert.equal(extensionFromContentType(null), "");
  });

  test("detects text-like responses", () => {
    assert.equal(isTextResponse("text/plain"), true);
    assert.equal(isTextResponse("application/json"), true);
    assert.equal(isTextResponse("application/javascript"), true);
    assert.equal(isTextResponse("image/svg+xml"), true);
    assert.equal(isTextResponse("text/html"), true);
  });

  test("identifies binary responses as non-text", () => {
    assert.equal(isTextResponse("image/png"), false);
    assert.equal(isTextResponse("application/octet-stream"), false);
  });
});
