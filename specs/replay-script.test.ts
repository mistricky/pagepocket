import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildReplayScript } from "../src/lib/replay-script";
import type { SnapshotData } from "../src/lib/types";

describe("buildReplayScript", () => {
  test("injects snapshot payload with escaped script tags", () => {
    const snapshot: SnapshotData = {
      url: "https://example.com",
      title: "bad </script> title",
      capturedAt: "2024-01-01T00:00:00Z",
      fetchXhrRecords: [],
      networkRecords: [],
      resources: []
    };

    const script = buildReplayScript(snapshot, "https://example.com");
    assert.ok(script.includes("bad <\\/script> title"));
    assert.ok(script.includes("hacker:replay-fetch-responder"));
  });

  test("includes base URL payload", () => {
    const snapshot: SnapshotData = {
      url: "https://example.com",
      title: "title",
      capturedAt: "2024-01-01T00:00:00Z",
      fetchXhrRecords: [],
      networkRecords: [],
      resources: []
    };

    const script = buildReplayScript(snapshot, "https://example.com/base/");
    assert.ok(script.includes("https://example.com/base/"));
  });
});
