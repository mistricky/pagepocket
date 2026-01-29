import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { NetworkEvent } from "@pagepocket/lib";
import { PagePocket } from "@pagepocket/lib";

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

test("CdpAdapter emits request and response events with buffered body", async () => {
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

  client.emit("Network.loadingFinished", {
    requestId: "1"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
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
  assert.equal(responseEvent.body?.kind, "buffer");

  const body = responseEvent.body?.kind === "buffer" ? responseEvent.body.data : undefined;
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

  client.emit("Network.loadingFinished", {
    requestId: "7"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(responseEvent);
  const body = responseEvent.body?.kind === "buffer" ? responseEvent.body.data : undefined;
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

test("CdpAdapter synthesizes request when response arrives first", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "<html>ok</html>",
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

  client.emit("Network.responseReceived", {
    requestId: "20",
    frameId: "frame-20",
    response: {
      url: "https://example.test/page",
      status: 200,
      headers: {
        "content-type": "text/html"
      },
      mimeType: "text/html"
    }
  });

  client.emit("Network.loadingFinished", {
    requestId: "20"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const requestEvent = events.find((event) => event.type === "request");
  assert.ok(requestEvent);
  assert.equal(requestEvent.resourceType, "document");
  assert.equal(requestEvent.frameId, "frame-20");

  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(responseEvent);
  assert.equal(responseEvent.body?.kind, "buffer");
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

test("CdpAdapter infers resource type from mimeType when request type is missing", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "<html>ok</html>",
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
    requestId: "12",
    frameId: "frame-12",
    request: {
      url: "https://example.test/page",
      method: "GET",
      headers: {}
    }
  });

  client.emit("Network.responseReceived", {
    requestId: "12",
    response: {
      url: "https://example.test/page",
      status: 200,
      headers: {
        "content-type": "text/html"
      },
      mimeType: "text/html"
    }
  });

  client.emit("Network.loadingFinished", {
    requestId: "12"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const requestEvents = events.filter((event) => event.type === "request");
  assert.ok(requestEvents.length >= 1);
  const lastRequest = requestEvents[requestEvents.length - 1];
  assert.equal(lastRequest.resourceType, "document");

  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(responseEvent);
  assert.equal(responseEvent.body?.kind, "buffer");
  await session.stop();
});

test("CdpAdapter falls back to Page.getResourceContent when response body is empty", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "",
    base64Encoded: false
  }));
  client.sendHandlers.set("Page.getResourceContent", async () => ({
    content: "PGh0bWw+ZmFsbGJhY2s8L2h0bWw+",
    base64Encoded: true
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
    requestId: "13",
    frameId: "frame-13",
    request: {
      url: "https://example.test/page",
      method: "GET",
      headers: {}
    }
  });

  client.emit("Network.responseReceived", {
    requestId: "13",
    response: {
      url: "https://example.test/page",
      status: 200,
      headers: {
        "content-type": "text/html"
      },
      mimeType: "text/html"
    }
  });

  client.emit("Network.loadingFinished", {
    requestId: "13"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(responseEvent);
  assert.equal(responseEvent.body?.kind, "buffer");
  const body = responseEvent.body?.kind === "buffer" ? responseEvent.body.data : undefined;
  assert.ok(body);
  assert.equal(new TextDecoder().decode(body), "<html>fallback</html>");
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
  const calls: Array<{ tabId: number; protocolVersion: string }> = [];
  const adapter = new CdpAdapter({
    clientFactory: async (options) => {
      calls.push(options as { tabId: number; protocolVersion: string });
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
  assert.equal(calls[0].tabId, 42);
  assert.equal(calls[0].protocolVersion, "1.3");
  await session.stop();
});

test("CdpAdapter derives event timestamps from wallTime and monotonic timestamp", async () => {
  const client = new MockCdpClient();
  client.sendHandlers.set("Network.getResponseBody", async () => ({
    body: "<html>ok</html>",
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

  const wallTime = 2000;
  const timestamp = 100;

  client.emit("Network.requestWillBeSent", {
    requestId: "ts-1",
    timestamp,
    wallTime,
    request: {
      url: "https://example.test/",
      method: "GET",
      headers: {}
    }
  });

  client.emit("Network.responseReceived", {
    requestId: "ts-1",
    timestamp: timestamp + 1,
    response: {
      url: "https://example.test/",
      status: 200,
      headers: {
        "content-type": "text/html"
      },
      mimeType: "text/html"
    }
  });

  client.emit("Network.loadingFinished", {
    requestId: "ts-1",
    timestamp: timestamp + 2
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const requestEvent = events.find((event) => event.type === "request");
  const responseEvent = events.find((event) => event.type === "response");
  assert.ok(requestEvent);
  assert.ok(responseEvent);
  assert.equal(requestEvent.timestamp, wallTime * 1000);
  assert.equal(responseEvent.timestamp, (wallTime + 2) * 1000);

  await session.stop();
});

const walkFiles = async (baseDir: string) => {
  const entries = await readdir(baseDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(baseDir, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await walkFiles(full);
      for (const child of childFiles) {
        files.push(join(entry.name, child));
      }
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
};

const isFontAsset = (path: string) =>
  path.endsWith(".ttf") ||
  path.endsWith(".woff") ||
  path.endsWith(".woff2") ||
  path.endsWith(".otf") ||
  path.endsWith(".eot");

test("CdpAdapter replay matches Moon snapshot output (except font binaries)", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(testDir, "..", "..", "..", "..");
  const inputPath = join(
    repoRoot,
    "packages",
    "lighterceptor",
    "examples",
    "Moon_Bartosz_Ciechanowski.requests.json"
  );
  const expectedDir = join(
    repoRoot,
    "packages",
    "cli",
    "resources",
    "Moon_Bartosz_Ciechanowski"
  );

  const inputRaw = await readFile(inputPath, "utf8");
  const input = JSON.parse(inputRaw) as {
    networkRecords: Array<{
      url: string;
      source?: string;
      method?: string;
      timestamp?: number;
      response?: {
        status?: number;
        statusText?: string;
        headers?: Record<string, string>;
        body?: string;
        bodyEncoding?: "base64" | "text";
      };
    }>;
  };

  const expectedIndex = await readFile(join(expectedDir, "index.html"), "utf8");
  const expectedApiRaw = await readFile(join(expectedDir, "api.json"), "utf8");
  const expectedApi = JSON.parse(expectedApiRaw) as {
    createdAt?: number;
    records?: Array<{
      url: string;
      method?: string;
      status?: number;
      statusText?: string;
      responseHeaders?: Record<string, string>;
      responseBody?: string;
      responseBodyBase64?: string;
      responseEncoding?: "text" | "base64";
      timestamp?: number;
    }>;
  };

  class MockCdpReplayClient extends MockCdpClient {}

  const client = new MockCdpReplayClient();
  const adapter = createAdapterWithClient(client);
  const responseById = new Map<string, { body?: string; bodyEncoding?: string }>();
  let idSeq = 0;

  const events: Array<{ method: string; params: Record<string, unknown> }> = [];

  const addRecord = (record: {
    url: string;
    method?: string;
    timestamp?: number;
    source?: string;
    response?: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyEncoding?: "base64" | "text";
    };
  }) => {
    const requestId = `req-${idSeq++}`;
    const headers = record.response?.headers ?? {};
    const contentType = headers["content-type"] ?? headers["Content-Type"];
    const mimeType = contentType ? String(contentType) : undefined;
    responseById.set(requestId, {
      body: record.response?.body,
      bodyEncoding: record.response?.bodyEncoding
    });

    const wallTime = (record.timestamp ?? Date.now()) / 1000;
    const monotonic = wallTime;
    const cdpType = record.source === "fetch" ? "Fetch" : undefined;

    events.push({
      method: "Network.requestWillBeSent",
      params: {
        requestId,
        frameId: "frame-1",
        type: cdpType,
        request: {
          url: record.url,
          method: record.method || "GET",
          headers: {}
        },
        timestamp: monotonic,
        wallTime
      }
    });

    events.push({
      method: "Network.responseReceived",
      params: {
        requestId,
        frameId: "frame-1",
        type: cdpType,
        response: {
          url: record.url,
          status: record.response?.status ?? 200,
          statusText: record.response?.statusText ?? "",
          headers,
          mimeType
        },
        timestamp: monotonic + 0.5
      }
    });

    events.push({
      method: "Network.loadingFinished",
      params: {
        requestId,
        timestamp: monotonic + 1
      }
    });
  };

  for (const record of input.networkRecords) {
    addRecord(record);
  }

  addRecord({
    url: "https://ciechanow.ski/moon/",
    method: "GET",
    timestamp: expectedApi.createdAt ?? Date.now(),
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html; charset=utf-8" },
      body: expectedIndex,
      bodyEncoding: "text"
    }
  });

  for (const record of expectedApi.records ?? []) {
    if (record.url.includes("ccm/geo")) {
      continue;
    }
    const bodyEncoding = record.responseEncoding ?? "text";
    const body =
      bodyEncoding === "base64" ? record.responseBodyBase64 ?? "" : record.responseBody ?? "";
    addRecord({
      url: record.url,
      method: record.method ?? "GET",
      timestamp: record.timestamp ?? expectedApi.createdAt ?? Date.now(),
      source: "fetch",
      response: {
        status: record.status ?? 200,
        statusText: record.statusText ?? "",
        headers: record.responseHeaders ?? {},
        body,
        bodyEncoding: bodyEncoding === "base64" ? "base64" : "text"
      }
    });
  }

  client.sendHandlers.set("Network.getResponseBody", async (params) => {
    const requestId = params?.requestId as string;
    const stored = responseById.get(requestId);
    if (!stored) {
      throw new Error("No data found for resource with given identifier");
    }
    return {
      body: stored.body ?? "",
      base64Encoded: stored.bodyEncoding === "base64"
    };
  });

  const outputDir = await mkdtemp(join(tmpdir(), "pp-cdp-moon-"));

  try {
    const pagePocket = PagePocket.fromTarget({ kind: "cdp-tab", tabId: 1 });
    const capturePromise = pagePocket.capture({
      interceptor: adapter,
      completion: {
        async wait() {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const event of events) {
      client.emit(event.method, event.params);
    }

    const snapshot = await capturePromise;
    await snapshot.toDirectory(outputDir, { clearCache: true });

    const excludedExpectedFiles = new Set([
      "external_resources/analytics.js",
      "external_resources/gtag/js__ppq_2c0f16f3",
      "images/moon/earth_clouds.png",
      "images/moon/earth_color.png",
      "images/moon/earth_sdf.png",
      "images/moon/moon_color.png",
      "images/moon/moon_height_map.png",
      "images/moon/noise.png"
    ]);
    const expectedFiles = (await walkFiles(expectedDir))
      .filter((file) => !isFontAsset(file))
      .filter((file) => !excludedExpectedFiles.has(file));
    const actualFiles = (await walkFiles(outputDir)).filter((file) => !isFontAsset(file));

    expectedFiles.sort();
    actualFiles.sort();

    assert.deepEqual(actualFiles, expectedFiles);

    for (const relPath of expectedFiles) {
      if (relPath === "api.json") {
        const expectedJson = JSON.parse(
          await readFile(join(expectedDir, relPath), "utf8")
        ) as { url?: string; version?: string; records?: unknown[] };
        const actualJson = JSON.parse(
          await readFile(join(outputDir, relPath), "utf8")
        ) as { url?: string; version?: string; records?: unknown[] };
        assert.equal(actualJson.url, expectedJson.url, relPath);
        assert.equal(actualJson.version, expectedJson.version, relPath);
        assert.ok(Array.isArray(actualJson.records), relPath);
        assert.ok((actualJson.records ?? []).length > 0, relPath);
        continue;
      }
      if (relPath === "index.html") {
        continue;
      }
      if (relPath.startsWith("external_resources/")) {
        continue;
      }
      const expectedBytes = await readFile(join(expectedDir, relPath));
      const actualBytes = await readFile(join(outputDir, relPath));
      assert.equal(actualBytes.byteLength, expectedBytes.byteLength, relPath);
      assert.ok(actualBytes.equals(expectedBytes), relPath);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
