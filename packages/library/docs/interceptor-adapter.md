# Implementing a PagePocket-Compatible InterceptorAdapter

This document explains how to implement a `NetworkInterceptorAdapter` compatible with PagePocket. An adapter converts tool-specific network events (Puppeteer/CDP/custom capture) into the standardized event stream used by PagePocket to build snapshots.

## Core Interface

```ts
interface NetworkInterceptorAdapter {
  readonly name: string;
  readonly capabilities: InterceptorCapabilities;
  start(
    target: InterceptTarget,
    handlers: NetworkEventHandlers,
    options?: InterceptOptions
  ): Promise<InterceptSession>;
}
```

### InterceptTarget

```ts
type InterceptTarget =
  | { kind: "url"; url: string }
  | { kind: "puppeteer-page"; page: unknown }
  | { kind: "cdp-tab"; tabId: number }
  | { kind: "cdp-session"; session: unknown };
```

- `kind: 'url'`: the adapter performs navigation (if it implements `session.navigate`).
- Other kinds: the caller provides an existing context/page and the adapter only intercepts.

### InterceptorCapabilities

```ts
interface InterceptorCapabilities {
  canGetResponseBody: boolean;
  canStreamResponseBody: boolean;
  canGetRequestBody: boolean;
  providesResourceType: boolean;
}
```

> Note: capabilities are for PagePocket to understand what may be available. Actual behavior is determined by the events you emit.

## Event Contract (Must Follow)

### Request

```ts
interface NetworkRequestEvent {
  type: "request";
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  frameId?: string;
  resourceType?: ResourceType;
  initiator?: { type?: string; url?: string };
  timestamp: number;
}
```

### Response

```ts
type BodySource =
  | { kind: "buffer"; data: Uint8Array }
  | { kind: "stream"; stream: ReadableStream<Uint8Array> }
  | { kind: "late"; read: () => Promise<Uint8Array> };

interface NetworkResponseEvent {
  type: "response";
  requestId: string;
  url: string;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  mimeType?: string;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  timestamp: number;
  body?: BodySource;
}
```

### Failed

```ts
interface NetworkRequestFailedEvent {
  type: "failed";
  requestId: string;
  url: string;
  errorText: string;
  timestamp: number;
}
```

## Implementation Guidelines

1. **Event order**

- For the same `requestId`, emit `request` before `response` or `failed`.
- `timestamp` should be a millisecond epoch (e.g. `Date.now()`).

2. **requestId correlation**

- `requestId` links request/response/failure and must be stable and consistent.

3. **Providing response bodies**

- Prefer including `body`:
  - `buffer`: complete bytes available
  - `stream`: streaming available
  - `late`: deferred read (fits Puppeteer/CDP `response.buffer()`)

4. **No auto-fetch in PagePocket core**

- If the adapter needs to actively fetch (e.g. Lighterceptor), it must do so inside the adapter and emit a `response` event with body.

5. **resourceType**

- Provide `resourceType` whenever possible (`document/stylesheet/script/image/font/media/xhr/fetch/...`).
- `fetch/xhr` are recorded into `api.json` only and are not saved as files.

6. **Multi-document/iframe support**

- Provide `frameId` or `initiator.url` when available; these are used for multi-document grouping.

## Typical Skeleton

```ts
class MyAdapter implements NetworkInterceptorAdapter {
  name = "my-adapter";
  capabilities = {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: true
  };

  async start(target: InterceptTarget, handlers: NetworkEventHandlers): Promise<InterceptSession> {
    // 1. attach / setup event listeners
    // 2. on request -> handlers.onEvent({ type: 'request', ... })
    // 3. on response -> handlers.onEvent({ type: 'response', ... })
    // 4. on failure -> handlers.onEvent({ type: 'failed', ... })

    return {
      navigate: async (url: string) => {
        // optional: only if your adapter can navigate
      },
      stop: async () => {
        // teardown listeners, detach from target
      }
    };
  }
}
```

## Compatibility Checklist

- [ ] request/response/failed event shape is correct
- [ ] requestId correlation is correct
- [ ] response body provided via `BodySource`
- [ ] resourceType is accurate when possible
- [ ] no network fetch inside PagePocket core
- [ ] provide frameId/initiator for multi-document cases
