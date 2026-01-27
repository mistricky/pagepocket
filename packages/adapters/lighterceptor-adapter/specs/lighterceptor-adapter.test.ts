import assert from "node:assert/strict";
import { test } from "node:test";

import { PagePocket } from "@pagepocket/lib";
import { LighterceptorAdapter } from "../src/index";
import type { NetworkEvent } from "@pagepocket/lib";

type MockResponse = {
  status?: number;
  headers?: Record<string, string>;
  body: string | Uint8Array;
};

const withMockedFetch = async (
  responses: Record<string, MockResponse>,
  run: () => Promise<void>
) => {
  const globalWithFetch = globalThis as { fetch?: typeof fetch };
  const originalFetch = globalWithFetch.fetch;
  globalWithFetch.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = responses[url];
    if (!response) {
      return new Response("not found", { status: 404 });
    }
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: response.headers
    });
  };
  try {
    await run();
  } finally {
    if (originalFetch) {
      globalWithFetch.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  }
};

const makeFixtureResponses = () => {
  const html = `
    <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <img src="/image.png">
      </body>
    </html>
  `;
  const css = `body { background: url("/bg.png"); }`;
  const image = new Uint8Array([1, 2, 3, 4]);
  const bg = new Uint8Array([5, 6, 7, 8]);

  return {
    "https://example.test/": {
      body: html,
      headers: { "content-type": "text/html; charset=utf-8" }
    },
    "https://example.test/styles.css": {
      body: css,
      headers: { "content-type": "text/css" }
    },
    "https://example.test/image.png": {
      body: image,
      headers: { "content-type": "image/png" }
    },
    "https://example.test/bg.png": {
      body: bg,
      headers: { "content-type": "image/png" }
    }
  };
};

test("LighterceptorAdapter infers document resourceType from response headers", async () => {
  const responses = makeFixtureResponses();
  await withMockedFetch(responses, async () => {
    const adapter = new LighterceptorAdapter();
    const events: NetworkEvent[] = [];
    const session = await adapter.start(
      { kind: "url", url: "https://example.test/" },
      {
        onEvent: (event) => events.push(event)
      }
    );
    await session.stop();

    const docRequest = events.find(
      (event) => event.type === "request" && event.url === "https://example.test/"
    );
    assert.ok(docRequest);
    assert.equal(docRequest.resourceType, "document");
  });
});

test("LighterceptorAdapter decodes binary response bodies", async () => {
  const responses = makeFixtureResponses();
  await withMockedFetch(responses, async () => {
    const adapter = new LighterceptorAdapter();
    const events: NetworkEvent[] = [];
    const session = await adapter.start(
      { kind: "url", url: "https://example.test/" },
      {
        onEvent: (event) => events.push(event)
      }
    );
    await session.stop();

    const imageResponse = events.find(
      (event) => event.type === "response" && event.url === "https://example.test/image.png"
    );
    assert.ok(imageResponse);
    assert.equal(imageResponse.body?.kind, "buffer");
    assert.equal(imageResponse.body?.data.byteLength, 4);
    assert.equal(imageResponse.body?.data[0], 1);
  });
});

test("PagePocket capture with LighterceptorAdapter writes snapshot files", async () => {
  const responses = makeFixtureResponses();
  await withMockedFetch(responses, async () => {
    const snapshot = await PagePocket.fromURL("https://example.test/").capture({
      interceptor: new LighterceptorAdapter(),
      completion: { wait: async () => {} }
    });

    const paths = snapshot.files.map((file) => file.path);
    assert.ok(paths.includes("/index.html"));
    assert.ok(paths.includes("/styles.css"));
    assert.ok(paths.includes("/image.png"));
    assert.ok(paths.includes("/api.json"));
  });
});
