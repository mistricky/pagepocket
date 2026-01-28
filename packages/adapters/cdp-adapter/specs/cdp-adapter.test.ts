import assert from "node:assert/strict";
import { test } from "node:test";

import type { NetworkEvent } from "@pagepocket/lib";

import { CdpAdapter } from "../src/index";

type EventHandler = (payload: unknown) => void;

type SendHandler = (params?: Record<string, unknown>) => Promise<unknown> | unknown;

class MockCdpClient {
  private handlers = new Map<string, Set<EventHandler>>();
  readonly sendCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly sendHandlers = new Map<string, SendHandler>();
  closeCalls = 0;

  on(event: string, listener: EventHandler) {
    const list = this.handlers.get(event) ?? new Set<EventHandler>();
    list.add(listener);
    this.handlers.set(event, list);
  }

  off(event: string, listener: EventHandler) {
    const list = this.handlers.get(event);
    if (!list) return;
    list.delete(listener);
  }

  emit(event: string, payload: unknown) {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      handler(payload);
    }
  }

  send(method: string, params?: Record<string, unknown>) {
    this.sendCalls.push({ method, params });
    const handler = this.sendHandlers.get(method);
    if (handler) {
      return handler(params) as Promise<unknown>;
    }
    return undefined;
  }

  close() {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

const createAdapterWithClient = (client: MockCdpClient) =>
  new CdpAdapter({
    clientFactory: async () => client
  });

test("CdpAdapter emits request and response events with late body", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "hello",
    base64Encoded: false
  }));

  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.requestWillBeSent", {
    requestId: "1",
    frameId: "frame-1",
    type: "Document",
    initiator: { type: "parser", url: "https://example.test" },
    request: {
      url: "https://example.test/",
      method: "GET",
      headers: {
        "content-type": "text/html"
      }
    }
  });

  client.emit("Network.responseReceived", {
    requestId: "1",
    type: "Document",
    response: {
      url: "https://example.test/",
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/html"
      },
      mimeType: "text/html",
      fromDiskCache: false,
      fromServiceWorker: false
    }
  });

  await session.stop();

  const requestEvent = events.find((event) => event.type === "request");
  assert.ok(requestEvent);
  assert.equal(requestEvent.requestId, "1:0");
  assert.equal(requestEvent.resourceType, "document");
  assert.equal(requestEvent.frameId, "frame-1");
  assert.equal(requestEvent.initiator?.type, "parser");
  assert.equal(requestEvent.headers["content-type"], "text/html");
  assert.ok(typeof requestEvent.timestamp === "number");

  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(responseEvent);
  assert.equal(responseEvent.requestId, "1:0");
  assert.equal(responseEvent.status, 200);
  assert.equal(responseEvent.headers["content-type"], "text/html");
  assert.equal(responseEvent.body?.kind, "late");

  const body = await responseEvent.body?.read();
  assert.ok(body);
  assert.equal(new TextDecoder().decode(body), "hello");
});

test("CdpAdapter decodes base64 response bodies without Buffer", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "AQID",
    base64Encoded: true
  }));

  const globalWithBuffer = globalThis as { Buffer?: typeof Buffer };
  const originalBuffer = globalWithBuffer.Buffer;
  delete globalWithBuffer.Buffer;

  try {
    const adapter = createAdapterWithClient(client);
    const events: NetworkEvent[] = [];
    const session = await adapter.start(
      { kind: "cdp-tab", tabId: 1 },
      {
        onEvent: (event) => events.push(event)
      }
    );

    client.emit("Network.requestWillBeSent", {
      requestId: "7",
      request: {
        url: "https://example.test/image.png",
        method: "GET",
        headers: {}
      }
    });
    client.emit("Network.responseReceived", {
      requestId: "7",
      response: {
        url: "https://example.test/image.png",
        status: 200,
        headers: {
          "content-type": "image/png"
        },
        mimeType: "image/png"
      }
    });

    const responseEvent = events.find((event) => event.type === "response");
    assert.ok(responseEvent);
    const body = await responseEvent.body?.read();
    assert.ok(body);
    assert.deepEqual(Array.from(body), [1, 2, 3]);
    await session.stop();
  } finally {
    if (originalBuffer) {
      globalWithBuffer.Buffer = originalBuffer;
    } else {
      delete globalWithBuffer.Buffer;
    }
  }
});

test("CdpAdapter emits redirect response before next request in chain", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.requestWillBeSent", {
    requestId: "2",
    request: {
      url: "https://example.test/",
      method: "GET",
      headers: {}
    }
  });

  client.emit("Network.requestWillBeSent", {
    requestId: "2",
    redirectResponse: {
      url: "https://example.test/",
      status: 302,
      statusText: "Found",
      headers: {
        location: "https://example.test/new"
      },
      mimeType: "text/html"
    },
    request: {
      url: "https://example.test/new",
      method: "GET",
      headers: {}
    }
  });

  assert.equal(events.length, 3);
  assert.equal(events[1].type, "response");
  assert.equal(events[1].requestId, "2:0");
  assert.equal(events[2].type, "request");
  assert.equal(events[2].requestId, "2:1");
  await session.stop();
});

test("CdpAdapter emits failed event with best-known url", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.requestWillBeSent", {
    requestId: "3",
    request: {
      url: "https://example.test/api",
      method: "GET",
      headers: {}
    }
  });

  client.emit("Network.loadingFailed", {
    requestId: "3",
    errorText: "net::ERR_FAILED"
  });

  const failed = events.find((event) => event.type === "failed");
  assert.ok(failed);
  assert.equal(failed.url, "https://example.test/api");
  await session.stop();
});

test("CdpAdapter captures url from response when request is missing", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.responseReceived", {
    requestId: "4",
    response: {
      url: "https://example.test/missed",
      status: 200,
      headers: {},
      mimeType: "text/html"
    }
  });

  client.emit("Network.loadingFailed", {
    requestId: "4",
    errorText: "net::ERR_FAILED"
  });

  const failed = events.find((event) => event.type === "failed");
  assert.ok(failed);
  assert.equal(failed.url, "https://example.test/missed");
  await session.stop();
});

test("CdpAdapter navigate uses Page domain and stop closes owned client", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 2 },
    {
      onEvent: () => {}
    }
  );

  await session.navigate?.("https://example.test/");
  await session.stop();

  assert.ok(
    client.sendCalls.some((call) => call.method === "Page.enable"),
    "Page.enable should be called"
  );
  assert.ok(
    client.sendCalls.some(
      (call) => call.method === "Page.navigate" && call.params?.url === "https://example.test/"
    ),
    "Page.navigate should be called"
  );
  assert.equal(client.closeCalls, 1);
});

test("CdpAdapter does not close externally managed sessions", async () => {
  const client = new MockCdpClient();
  const adapter = new CdpAdapter();
  const session = await adapter.start(
    { kind: "cdp-session", session: client },
    {
      onEvent: () => {}
    }
  );
  await session.stop();
  assert.equal(client.closeCalls, 0);
});

test("CdpAdapter maps CDP resource types to PagePocket types", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.requestWillBeSent", {
    requestId: "9",
    type: "Fetch",
    request: {
      url: "https://example.test/api",
      method: "GET",
      headers: {}
    }
  });

  const requestEvent = events.find((event) => event.type === "request");
  assert.ok(requestEvent);
  assert.equal(requestEvent.resourceType, "fetch");
  await session.stop();
});

test("CdpAdapter normalizes header values", async () => {
  const client = new MockCdpClient();
  const adapter = createAdapterWithClient(client);
  const events: NetworkEvent[] = [];
  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 1 },
    {
      onEvent: (event) => events.push(event)
    }
  );

  client.emit("Network.requestWillBeSent", {
    requestId: "11",
    request: {
      url: "https://example.test/headers",
      method: "GET",
      headers: {
        "x-list": ["a", "b"],
        "x-num": 123
      }
    }
  });

  const requestEvent = events.find((event) => event.type === "request");
  assert.ok(requestEvent);
  assert.equal(requestEvent.headers["x-list"], "a, b");
  assert.equal(requestEvent.headers["x-num"], "123");
  await session.stop();
});

test("CdpAdapter passes connection options to clientFactory", async () => {
  const client = new MockCdpClient();
  const calls: Array<{ host?: string; port?: number; target?: string | number }> = [];
  const adapter = new CdpAdapter({
    host: "127.0.0.1",
    port: 9222,
    target: "override",
    clientFactory: async (options) => {
      calls.push(options);
      return client;
    }
  });

  const session = await adapter.start(
    { kind: "cdp-tab", tabId: 42 },
    {
      onEvent: () => {}
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "127.0.0.1");
  assert.equal(calls[0].port, 9222);
  assert.equal(calls[0].target, "override");
  await session.stop();
});
