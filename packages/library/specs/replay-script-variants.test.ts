import assert from "node:assert";
import { describe, test } from "node:test";

import { buildReplayScript } from "../src/replay-script";

describe("buildReplayScript api.json wiring", () => {
  test("loads api.json and wires fetch/xhr replay", () => {
    const script = buildReplayScript("/api.json", "https://example.com/");
    assert.ok(script.includes("api.json"), "missing api.json path");
    assert.ok(script.includes("loadApiSnapshot"), "missing api loader");
    assert.ok(script.includes("responseFromRecord"), "missing response builder");
  });
});
