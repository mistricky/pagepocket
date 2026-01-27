import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createDefaultPathResolver, resolveCrossOrigin } from "../src/path-resolver";

describe("default path resolver", () => {
  test("maps same-origin and cross-origin URLs", () => {
    const resolver = createDefaultPathResolver();
    const entryUrl = "https://example.com/index.html";

    const same = resolver.resolve({
      url: "https://example.com/assets/app.js",
      resourceType: "script",
      isCrossOrigin: resolveCrossOrigin("https://example.com/assets/app.js", entryUrl),
      entryUrl
    });
    const external = resolver.resolve({
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "script",
      isCrossOrigin: resolveCrossOrigin("https://cdn.example.com/assets/app.js", entryUrl),
      entryUrl
    });

    assert.equal(same, "/assets/app.js");
    assert.equal(external, "/external_resources/assets/app.js");
  });

  test("adds a stable suffix for query/hash variants", () => {
    const resolver = createDefaultPathResolver();
    const entryUrl = "https://example.com";

    const first = resolver.resolve({
      url: "https://example.com/app.js?v=1",
      resourceType: "script",
      isCrossOrigin: false,
      entryUrl
    });
    const second = resolver.resolve({
      url: "https://example.com/app.js?v=2",
      resourceType: "script",
      isCrossOrigin: false,
      entryUrl
    });

    assert.notEqual(first, second);
    assert.ok(first.startsWith("/app"));
    assert.ok(second.startsWith("/app"));
  });
});
