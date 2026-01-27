# 实现 PagePocket 兼容的 InterceptorAdapter

本文说明如何实现与 PagePocket 兼容的 `NetworkInterceptorAdapter`。适配器负责把具体工具的网络事件（Puppeteer/CDP/自研抓取器）转换为统一事件流，供 PagePocket 生成快照。

## 核心接口

```ts
interface NetworkInterceptorAdapter {
  readonly name: string
  readonly capabilities: InterceptorCapabilities
  start(
    target: InterceptTarget,
    handlers: NetworkEventHandlers,
    options?: InterceptOptions
  ): Promise<InterceptSession>
}
```

### InterceptTarget

```ts
type InterceptTarget =
  | { kind: 'url'; url: string }
  | { kind: 'puppeteer-page'; page: unknown }
  | { kind: 'cdp-tab'; tabId: number }
  | { kind: 'cdp-session'; session: unknown }
```

- `kind: 'url'`：适配器负责导航（如果实现了 `session.navigate`）。
- 其余类型：由调用方传入已有上下文/页面，适配器只负责拦截。

### InterceptorCapabilities

```ts
interface InterceptorCapabilities {
  canGetResponseBody: boolean
  canStreamResponseBody: boolean
  canGetRequestBody: boolean
  providesResourceType: boolean
}
```

> 注意：能力声明用于 PagePocket 评估可用信息，实际行为仍以事件内容为准。

## 事件规范（必须遵守）

### Request

```ts
interface NetworkRequestEvent {
  type: 'request'
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  frameId?: string
  resourceType?: ResourceType
  initiator?: { type?: string; url?: string }
  timestamp: number
}
```

### Response

```ts
type BodySource =
  | { kind: 'buffer'; data: Uint8Array }
  | { kind: 'stream'; stream: ReadableStream<Uint8Array> }
  | { kind: 'late'; read: () => Promise<Uint8Array> }

interface NetworkResponseEvent {
  type: 'response'
  requestId: string
  url: string
  status: number
  statusText?: string
  headers: Record<string, string>
  mimeType?: string
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  timestamp: number
  body?: BodySource
}
```

### Failed

```ts
interface NetworkRequestFailedEvent {
  type: 'failed'
  requestId: string
  url: string
  errorText: string
  timestamp: number
}
```

## 适配器实现要点

1) **事件顺序**
- 同一 `requestId` 必须先发 `request`，再发 `response` 或 `failed`。
- `timestamp` 应为毫秒级时间戳（如 `Date.now()`）。

2) **requestId 关联**
- `requestId` 用于关联请求与响应/失败，必须稳定一致。

3) **response body 提供方式**
- 推荐直接提供 `body`：
  - `buffer`：已拿到完整字节
  - `stream`：可流式读取
  - `late`：延迟读取（适合 Puppeteer/CDP 的 `response.buffer()`）

4) **不要在 PagePocket core 里发起网络请求**
- 如果适配器需要主动 fetch（例如 Lighterceptor），必须在适配器内部完成，并通过 `response` 事件提供 body。

5) **resourceType**
- 如果可提供 `resourceType`，务必填写（`document/stylesheet/script/image/font/media/xhr/fetch/...`）。
- `fetch/xhr` 只用于生成 `api.json`，不会作为资源文件保存。

6) **多文档/iframe 支持**
- 若能提供 `frameId` 或 `initiator.url`，请尽量提供，用于多文档分组。

## 典型实现骨架

```ts
class MyAdapter implements NetworkInterceptorAdapter {
  name = 'my-adapter'
  capabilities = {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: true
  }

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
    }
  }
}
```

## 兼容性检查清单

- [ ] request/response/failed 事件结构正确
- [ ] requestId 关联无误
- [ ] response body 通过 `BodySource` 提供
- [ ] resourceType 尽可能准确
- [ ] 不在 PagePocket core 内发起 fetch
- [ ] 支持多文档时提供 frameId/initiator

