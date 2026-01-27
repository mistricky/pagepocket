import assert from "node:assert/strict";
import { test } from "node:test";

import { PagePocket } from "../src/pagepocket";
import type {
  NetworkEvent,
  NetworkEventHandlers,
  NetworkInterceptorAdapter
} from "../src/types";

const streamToText = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value) {
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
};

const createMockAdapter = (events: NetworkEvent[]): NetworkInterceptorAdapter => ({
  name: "mock",
  capabilities: {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: true
  },
  async start(_target, handlers: NetworkEventHandlers) {
    for (const event of events) {
      handlers.onEvent(event);
    }
    return {
      async stop() {}
    };
  }
});

test("PagePocket.capture builds snapshot with rewritten HTML/CSS and api.json", async () => {
  const html = `
    <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <img src="/hero.png">
      </body>
    </html>
  `;
  const css = `body { background: url("/hero.png"); }`;
  const imageBytes = new Uint8Array([1, 2, 3]);

  const events: NetworkEvent[] = [
    {
      type: "request",
      requestId: "doc",
      url: "https://example.com/",
      method: "GET",
      headers: {},
      resourceType: "document",
      timestamp: 1
    },
    {
      type: "response",
      requestId: "doc",
      url: "https://example.com/",
      status: 200,
      headers: { "content-type": "text/html" },
      timestamp: 2,
      body: { kind: "buffer", data: new TextEncoder().encode(html) }
    },
    {
      type: "request",
      requestId: "css",
      url: "https://example.com/styles.css",
      method: "GET",
      headers: {},
      resourceType: "stylesheet",
      timestamp: 3
    },
    {
      type: "response",
      requestId: "css",
      url: "https://example.com/styles.css",
      status: 200,
      headers: { "content-type": "text/css" },
      timestamp: 4,
      body: { kind: "buffer", data: new TextEncoder().encode(css) }
    },
    {
      type: "request",
      requestId: "img",
      url: "https://example.com/hero.png",
      method: "GET",
      headers: {},
      resourceType: "image",
      timestamp: 5
    },
    {
      type: "response",
      requestId: "img",
      url: "https://example.com/hero.png",
      status: 200,
      headers: { "content-type": "image/png" },
      timestamp: 6,
      body: { kind: "buffer", data: imageBytes }
    },
    {
      type: "request",
      requestId: "fetch",
      url: "https://example.com/api/data",
      method: "GET",
      headers: {},
      resourceType: "fetch",
      timestamp: 7
    },
    {
      type: "response",
      requestId: "fetch",
      url: "https://example.com/api/data",
      status: 200,
      headers: { "content-type": "application/json" },
      timestamp: 8,
      body: { kind: "buffer", data: new TextEncoder().encode('{"ok":true}') }
    }
  ];

  const interceptor = createMockAdapter(events);
  const snapshot = await PagePocket.fromURL("https://example.com/").capture({
    interceptor,
    completion: { wait: async () => {} }
  });

  const paths = snapshot.files.map((file) => file.path);
  assert.ok(paths.includes("/index.html"));
  assert.ok(paths.includes("/styles.css"));
  assert.ok(paths.includes("/hero.png"));
  assert.ok(paths.includes("/api.json"));

  const entryFile = snapshot.files.find((file) => file.path === "/index.html");
  assert.ok(entryFile);
  const entryText = await streamToText(await snapshot.content.open(entryFile!.source));
  assert.ok(entryText.includes('/styles.css'));

  const cssFile = snapshot.files.find((file) => file.path === "/styles.css");
  assert.ok(cssFile);
  const cssText = await streamToText(await snapshot.content.open(cssFile!.source));
  assert.ok(cssText.includes("/hero.png"));

  const apiFile = snapshot.files.find((file) => file.path === "/api.json");
  assert.ok(apiFile);
  const apiText = await streamToText(await snapshot.content.open(apiFile!.source));
  assert.ok(apiText.includes('"url": "https://example.com/api/data"'));
});

test("PagePocket.capture groups multiple documents into separate directories", async () => {
  const events: NetworkEvent[] = [
    {
      type: "request",
      requestId: "doc1",
      url: "https://example.com/foo",
      method: "GET",
      headers: {},
      resourceType: "document",
      frameId: "frame-foo",
      timestamp: 1
    },
    {
      type: "response",
      requestId: "doc1",
      url: "https://example.com/foo",
      status: 200,
      headers: { "content-type": "text/html" },
      timestamp: 2,
      body: { kind: "buffer", data: new TextEncoder().encode("<html></html>") }
    },
    {
      type: "request",
      requestId: "doc2",
      url: "https://example.com/bar",
      method: "GET",
      headers: {},
      resourceType: "document",
      frameId: "frame-bar",
      timestamp: 3
    },
    {
      type: "response",
      requestId: "doc2",
      url: "https://example.com/bar",
      status: 200,
      headers: { "content-type": "text/html" },
      timestamp: 4,
      body: { kind: "buffer", data: new TextEncoder().encode("<html></html>") }
    }
  ];

  const interceptor = createMockAdapter(events);
  const snapshot = await PagePocket.fromURL("https://example.com/foo").capture({
    interceptor,
    completion: { wait: async () => {} }
  });

  const paths = snapshot.files.map((file) => file.path);
  assert.ok(paths.includes("/foo/index.html"));
  assert.ok(paths.includes("/bar/index.html"));
  assert.ok(paths.includes("/foo/api.json"));
  assert.ok(paths.includes("/bar/api.json"));
});
