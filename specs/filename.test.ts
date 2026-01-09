import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { safeFilename } from "../src/lib/filename";

describe("safeFilename", () => {
  test("trims and replaces unsafe characters", () => {
    assert.equal(safeFilename("  Hello, World!  "), "Hello_World");
    assert.equal(safeFilename("a/b:c*?d"), "a_b_c_d");
  });

  test("falls back to snapshot for blank names", () => {
    assert.equal(safeFilename("   "), "snapshot");
    assert.equal(safeFilename(""), "snapshot");
  });

  test("limits output length and preserves safe chars", () => {
    const input = "a".repeat(200);
    assert.equal(safeFilename(input).length, 120);
    assert.equal(safeFilename("valid-name_123.hello"), "valid-name_123.hello");
  });
});
