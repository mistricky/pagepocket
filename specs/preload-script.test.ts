import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildPreloadScript } from "../src/preload";

describe("buildPreloadScript", () => {
  test("includes recorder bootstrap and hackers", () => {
    const script = buildPreloadScript();
    assert.ok(script.includes("window.__webechoRecords"));
    assert.ok(script.includes("hacker:preload-fetch-recorder"));
    assert.ok(script.includes("hacker:preload-xhr-recorder"));
  });
});
