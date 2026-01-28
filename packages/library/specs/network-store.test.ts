import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NetworkStore } from "../src/network-store";
import { createDefaultResourceFilter } from "../src/resource-filter";
import type { BodySource, ContentRef, ContentStore, NetworkEvent } from "../src/types";

class MemoryContentStore implements ContentStore {
  name = "memory";
  private data = new Map<string, Uint8Array>();
  private counter = 0;

  async put(body: BodySource): Promise<ContentRef> {
    if (body.kind !== "buffer") {
      throw new Error("Expected buffer body");
    }
    const id = `mem-${this.counter++}`;
    this.data.set(id, body.data);
    return { kind: "store-ref", id };
  }

  async open(ref: ContentRef): Promise<ReadableStream<Uint8Array>> {
    if (ref.kind === "memory") {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(ref.data);
          controller.close();
        }
      });
    }
    const data = this.data.get(ref.id) ?? new Uint8Array();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }
}

describe("NetworkStore", () => {
  test("stores resources that pass filter and records api entries", async () => {
    const store = new NetworkStore({
      contentStore: new MemoryContentStore(),
      filter: createDefaultResourceFilter()
    });

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
        body: { kind: "buffer", data: new TextEncoder().encode("<html></html>") }
      },
      {
        type: "request",
        requestId: "fetch",
        url: "https://example.com/api/data",
        method: "GET",
        headers: {},
        resourceType: "fetch",
        timestamp: 3
      },
      {
        type: "response",
        requestId: "fetch",
        url: "https://example.com/api/data",
        status: 200,
        headers: { "content-type": "application/json" },
        timestamp: 4,
        body: { kind: "buffer", data: new TextEncoder().encode('{"ok":true}') }
      }
    ];

    for (const event of events) {
      await store.handleEvent(event);
    }

    const resources = store.getResources();
    assert.equal(resources.length, 1);
    assert.equal(resources[0].request.url, "https://example.com/");

    const apiRecords = store.getApiRecords();
    assert.equal(apiRecords.length, 1);
    assert.equal(apiRecords[0].url, "https://example.com/api/data");
  });

  test("skips 4xx responses by default", async () => {
    const store = new NetworkStore({
      contentStore: new MemoryContentStore(),
      filter: createDefaultResourceFilter()
    });

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
        status: 403,
        headers: { "content-type": "text/html" },
        timestamp: 2,
        body: { kind: "buffer", data: new TextEncoder().encode("<html></html>") }
      }
    ];

    for (const event of events) {
      await store.handleEvent(event);
    }

    assert.equal(store.getResources().length, 0);
  });

  test("applies resource limits", async () => {
    const store = new NetworkStore({
      contentStore: new MemoryContentStore(),
      filter: createDefaultResourceFilter(),
      limits: { maxResources: 1, maxTotalBytes: 10 }
    });

    const small = new Uint8Array([1, 2, 3, 4, 5]);
    const large = new Uint8Array(20);

    await store.handleEvent({
      type: "request",
      requestId: "doc1",
      url: "https://example.com/a",
      method: "GET",
      headers: {},
      resourceType: "document",
      timestamp: 1
    });
    await store.handleEvent({
      type: "response",
      requestId: "doc1",
      url: "https://example.com/a",
      status: 200,
      headers: { "content-type": "text/html" },
      timestamp: 2,
      body: { kind: "buffer", data: small }
    });

    await store.handleEvent({
      type: "request",
      requestId: "doc2",
      url: "https://example.com/b",
      method: "GET",
      headers: {},
      resourceType: "document",
      timestamp: 3
    });
    await store.handleEvent({
      type: "response",
      requestId: "doc2",
      url: "https://example.com/b",
      status: 200,
      headers: { "content-type": "text/html" },
      timestamp: 4,
      body: { kind: "buffer", data: large }
    });

    assert.equal(store.getResources().length, 1);
  });
});
