import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { HybridContentStore } from "../src/content-store";

test("HybridContentStore.dispose removes baseDir in node env", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pagepocket-store-"));
  const baseDir = join(tempDir, ".pagepocket_store");
  const store = new HybridContentStore({ thresholdBytes: 0, baseDir });

  await store.put(
    { kind: "buffer", data: new Uint8Array([1, 2, 3]) },
    { url: "https://example.com/resource.bin" }
  );
  await store.dispose();

  await assert.rejects(async () => {
    await access(baseDir);
  });

  await rm(tempDir, { recursive: true, force: true });
});
