import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildReplayScript } from "../src/lib/replay-script";
import path from "node:path";

describe("buildReplayScript", () => {
  test("includes requests json path and replay hackers", () => {
    const script = buildReplayScript("snapshot.requests.json", "https://example.com");
    assert.ok(script.includes("snapshot.requests.json"));
    assert.ok(script.includes("hacker:replay-fetch-responder"));
  });

  test("includes base URL payload", () => {
    const script = buildReplayScript("snapshot.requests.json", "https://example.com/base/");
    assert.ok(script.includes("https://example.com/base/"));
  });

  test("uses basename for requests path when provided a full path", () => {
    const requestsPath = path.join("/tmp", "snapshot.requests.json");
    const script = buildReplayScript(path.basename(requestsPath), "https://example.com");
    assert.ok(script.includes("snapshot.requests.json"));
  });
});
