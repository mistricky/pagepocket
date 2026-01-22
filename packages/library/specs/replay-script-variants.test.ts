import assert from "node:assert";
import { describe, test } from "node:test";

import { buildReplayScript } from "../src/replay-script";

const baseUrl = "https://transformer-circuits.pub/2025/attribution-graphs/biology.html";
const script = buildReplayScript("On_the_Biology_of_a_Large_Language_Model.requests.json", baseUrl);

const includes = (frag: string) => assert.ok(script.includes(frag), `missing: ${frag}`);

describe("buildReplayScript URL variant matching", () => {
  test("expandUrlVariants covers raw, normalized, baseOrigin/baseDir and cross-origin correction", () => {
    includes("expandUrlVariants");
    includes("baseOrigin");
    includes("baseDir");
    includes("variants.push(value)");
    includes("variants.push(normalizeUrl(value))");
    includes("baseOrigin + value");
    includes('baseDir + (value.startsWith("/") ? value : "/" + value)');
    includes("const parsed = new URL(value, baseUrl)");
    includes("parsed.origin !== baseOrigin");
    includes("baseOrigin + pathWithSearch");
    includes("variants.push(baseDir + path)");
  });

  test("primeLookups inserts variant keys for fetch/xhr and resources", () => {
    includes("makeVariantKeys");
    includes("expandUrlVariants(item.url)");
  });

  test("findRecord/findByUrl/findLocalPath iterate variants and fallback without query", () => {
    includes("const variants = expandUrlVariants(url);");
    includes("fallbackKey");
    includes("withoutQuery");
  });
});
