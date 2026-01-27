import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { buildReplayScript } from "../src/replay-script";

describe("buildReplayScript", () => {
  test("includes api.json path and replay hackers", () => {
    const script = buildReplayScript("/api.json", "https://example.com");
    assert.ok(script.includes("/api.json"));
    assert.ok(script.includes("hacker:replay-fetch-responder"));
  });

  test("includes base URL payload", () => {
    const script = buildReplayScript("/api.json", "https://example.com/base/");
    assert.ok(script.includes("https://example.com/base/"));
  });

  test("handles api.json path input", () => {
    const apiPath = path.join("/tmp", "api.json");
    const script = buildReplayScript(apiPath, "https://example.com");
    assert.ok(script.includes("api.json"));
  });
});
