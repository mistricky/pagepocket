# PagePocket 设计文档（API + 架构 + NetworkInterceptorAdapter）

> 目标：设计一个可扩展的网页保存库 PagePocket，使其能够通过不同的网络拦截器（Puppeteer Interceptor / CDP Interceptor）捕获页面资源，并以“快照（Snapshot）”形式输出，最终由存储适配器落地到 FS/Zip/OPFS 等。
>
> 本文只关注 **设计**（types / contracts / lifecycle / responsibilities），不讨论具体实现细节。

---

## 1. 核心目标与约束

### 1.1 目标
- **捕获**：获取页面所需资源（HTML/CSS/JS/图片/字体/媒体/XHR 等）及其响应数据。
- **重写**：将入口 HTML（及可选 CSS）中引用的 URL 重写为本地虚拟路径。
- **解耦**：
  - 与拦截器解耦（Puppeteer / CDP / 未来 SW/fetch patch）。
  - 与存储介质解耦（本地磁盘 / 临时文件 / Zip / OPFS / 远端存储）。
- **跨运行形态**：
  - Node：Puppeteer/Playwright/CDP client。
  - Chrome Extension：通过 `chrome.debugger` 的 CDP 事件流。
- **可扩展**：支持自定义过滤策略、路径策略、完成条件、内容存储策略。

### 1.2 非目标
- 不承诺自动覆盖所有 SPA 路由（路由发现可作为可选模块）。
- 不强制提供“完美还原所有动态行为”，仅提供捕获与回放所需资源基础设施。

---

## 2. 高层架构

### 2.1 模块划分
- **PagePocket（Orchestrator）**
  - 负责整体流程：启动拦截器 → 导航/运行 → 收集 → 生成快照
- **NetworkInterceptorAdapter（事件源）**
  - 负责将“工具特定的网络事件”标准化为统一的 NetworkEvent 流
- **NetworkStore（聚合器）**
  - 负责 request/response 关联、body 获取/落地、过滤、统计
- **PathResolver（路径策略）**
  - 负责将 URL 映射为快照内虚拟路径（posix relative）
- **Rewriter（重写器）**
  - 负责入口文档与（可选）CSS 中引用重写
- **ContentStore（内容存储抽象）**
  - 负责 body 的存放（内存 / 临时文件 / 句柄引用）
- **Writers（输出适配器）**
  - 如 writeToFS / toZip / writeToOPFS：纯 IO，将 snapshot 写出

### 2.2 数据流（推荐）
```
Interceptor (Puppeteer/CDP/...)  -->  NetworkEvent stream
                                         |
                                         v
                                  NetworkStore + ContentStore
                                         |
                                         v
                               PageSnapshot (virtual FS)
                                         |
                                         v
                           Writer (FS/Zip/OPFS/Remote)
```

---

## 3. 顶层 API 设计（PagePocket）

### 3.1 构建方式
```ts
class PagePocket {
  static fromURL(url: string, options?: PagePocketOptions): PagePocket
  static fromTarget(target: InterceptTarget, options?: PagePocketOptions): PagePocket
}
```

- `fromURL`：适合 Node（Puppeteer）或“拦截器内部可以自行导航”的场景。
- `fromTarget`：适合 Chrome Extension / CDP attach 到已有 tab 的场景。

### 3.2 主流程 API
```ts
interface PagePocket {
  capture(options?: CaptureOptions): Promise<PageSnapshot>
}
```

命名建议：
- `capture()` / `savePage()` 二选一
- `capture()` 更偏“生成快照”，`savePage()` 更偏“落地”但这里不落地

### 3.3 Convenience API（可选）
这些 API 是“组合”的封装，不污染核心语义。
```ts
interface PageSnapshot {
  // convenience（内部 = writer）
  toDirectory(outDir: string, options?: WriteFSOptions): Promise<WriteResult>
  toZip(options?: ZipOptions): Promise<Uint8Array | Blob>
}
```

---

## 4. CaptureOptions 设计

```ts
interface CaptureOptions {
  interceptor: NetworkInterceptorAdapter

  // 完成条件：何时算抓取结束（可组合）
  completion?: CompletionStrategy | CompletionStrategy[]

  // 资源过滤：决定哪些请求会被保存
  filter?: ResourceFilter

  // 虚拟路径策略
  pathResolver?: PathResolver

  // 内容存储策略（内存/临时文件/混合）
  contentStore?: ContentStore

  // 是否重写入口 HTML（默认 true）
  rewriteEntry?: boolean

  // 是否重写 CSS 引用（默认可选）
  rewriteCSS?: boolean

  // 限制/保护
  limits?: {
    maxTotalBytes?: number
    maxSingleResourceBytes?: number
    maxResources?: number
  }
}
```

---

## 5. NetworkInterceptorAdapter（关键接口）

### 5.1 设计原则
- **只提供“网络事实”**（请求/响应/失败 + 可选 body 源）
- **不提供文件路径，不做重写，不做落地**（这些属于 PagePocket/Writer）
- **可运行在 Node 或 Extension background**（通过各自实现）

### 5.2 拦截目标（Target）
拦截器需要知道“拦截谁”：
- Puppeteer：一个 page 或浏览器上下文
- CDP：一个 session 或 tabId

统一抽象：
```ts
type InterceptTarget =
  | { kind: 'url'; url: string }                 // 拦截器自行导航（Node 常用）
  | { kind: 'puppeteer-page'; page: unknown }    // 由上层传入（实现侧自行断言）
  | { kind: 'cdp-tab'; tabId: number }           // extension 常用
  | { kind: 'cdp-session'; session: unknown }    // Node raw CDP
```

> 说明：设计上允许 `unknown`，避免在 core package 引入 puppeteer 类型依赖。

### 5.3 事件处理器（handlers）
```ts
interface NetworkEventHandlers {
  onEvent(event: NetworkEvent): void
  onError?(error: Error): void
  onLog?(msg: string, meta?: any): void
}
```

### 5.4 生命周期接口
```ts
interface NetworkInterceptorAdapter {
  readonly name: string
  readonly capabilities: InterceptorCapabilities

  start(target: InterceptTarget, handlers: NetworkEventHandlers, options?: InterceptOptions): Promise<InterceptSession>
}
```

```ts
interface InterceptSession {
  // 可选：让拦截器去执行导航/动作（若 target.kind === 'url'）
  navigate?(url: string, options?: NavigateOptions): Promise<void>

  // 停止拦截、释放资源
  stop(): Promise<void>
}
```

### 5.5 能力声明（用于 PagePocket 适配差异）
```ts
interface InterceptorCapabilities {
  // 是否能拿到 response body（CDP / puppeteer 通常可以）
  canGetResponseBody: boolean

  // 是否能 stream body（某些实现可支持）
  canStreamResponseBody: boolean

  // 是否能拿到 request postData（可选）
  canGetRequestBody: boolean

  // 是否提供 resourceType / initiator 等增强信息
  providesResourceType: boolean
}
```

### 5.6 InterceptOptions（传给拦截器的选项）
```ts
interface InterceptOptions {
  // 是否包含 XHR/fetch
  includeXHR?: boolean

  // 是否包含媒体资源（video/audio）
  includeMedia?: boolean

  // 是否包含第三方域名
  includeCrossOrigin?: boolean

  // 是否保留重定向链
  trackRedirects?: boolean

  // 超时时间（拦截器侧）
  timeoutMs?: number
}
```

---

## 6. 标准化 NetworkEvent 设计

### 6.1 通用字段
- `requestId`：用于请求/响应关联（CDP 有；Puppeteer 也可映射）
- `timestamp`：单调时间或 epoch（保持一致即可）

### 6.2 请求事件
```ts
interface NetworkRequestEvent {
  type: 'request'
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  frameId?: string
  resourceType?: ResourceType
  initiator?: {
    type?: string
    url?: string
  }
  timestamp: number
}
```

### 6.3 响应事件
响应事件允许 body 是可选、且允许多种来源（buffer/stream/late）
```ts
type BodySource =
  | { kind: 'buffer'; data: Uint8Array }
  | { kind: 'stream'; stream: ReadableStream<Uint8Array> }
  | { kind: 'late'; read: () => Promise<Uint8Array> } // 延迟读取（实现侧可用）

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

### 6.4 失败事件
```ts
interface NetworkRequestFailedEvent {
  type: 'failed'
  requestId: string
  url: string
  errorText: string
  timestamp: number
}
```

### 6.5 ResourceType
```ts
type ResourceType =
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'media'
  | 'xhr'
  | 'fetch'
  | 'websocket'
  | 'other'
```

---

## 7. ContentStore（内容存储抽象）

### 7.1 设计目标
- 允许在 capture 阶段 **不把所有资源常驻内存**
- 支持：
  - 小资源内存
  - 大资源临时文件（或其他 backend）
- snapshot 返回时只携带 **ContentRef（句柄）**，不暴露真实路径

### 7.2 ContentRef
```ts
type ContentRef =
  | { kind: 'memory'; data: Uint8Array }
  | { kind: 'store-ref'; id: string } // opaque handle
```

### 7.3 ContentStore 接口
```ts
interface ContentStore {
  name: string

  // 将 body 写入 store，返回句柄（或内存 ref）
  put(body: BodySource, meta: { url: string; mimeType?: string; sizeHint?: number }): Promise<ContentRef>

  // 读取内容（writer 会用）
  open(ref: ContentRef): Promise<ReadableStream<Uint8Array>>

  // 可选：清理临时内容
  dispose?(): Promise<void>
}
```

> 说明：writer 统一通过 `open(ref)` 得到 stream，便于大资源管道式写出。

### 7.4 默认策略建议
- `HybridContentStore`：
  - `<= thresholdBytes` → memory
  - `> thresholdBytes` → temp store
- temp store 的实现可在 Node 用 tmp dir，在 extension 用 IndexedDB/OPFS（可选）。

---

## 8. PathResolver（虚拟路径策略）

### 8.1 设计原则
- 输出必须是 **POSIX 风格相对路径**（禁止 `\`、禁止 `..`、禁止前导 `/`）
- 不依赖真实文件系统
- 可去重（同 URL 不同 query 的策略可配置）

### 8.2 接口
```ts
interface PathResolver {
  resolve(input: {
    url: string
    resourceType?: ResourceType
    mimeType?: string
    suggestedFilename?: string
  }): string
}
```

### 8.3 推荐默认规则（示意）
- `index.html` 为入口
- 其他资源：`assets/<type>/<hash>.<ext>`
- ext 优先从 `mimeType` 推断，其次从 URL path。

---

## 9. ResourceFilter（保存过滤策略）

```ts
interface ResourceFilter {
  shouldSave(req: NetworkRequestEvent, res?: NetworkResponseEvent): boolean
}
```

默认建议：
- 保存：document/stylesheet/script/image/font/media
- xhr/fetch：默认不保存（可配置）
- `status >= 400` 默认不保存（可配置）
- data: / blob: 视具体策略

---

## 10. CompletionStrategy（结束条件）

网络拦截必须有“结束”概念。设计为可组合策略：

```ts
interface CompletionStrategy {
  wait(ctx: CompletionContext): Promise<void>
}

interface CompletionContext {
  // 由 PagePocket 提供的 hooks
  now(): number
  getStats(): {
    inflightRequests: number
    lastNetworkTs: number
    totalRequests: number
  }
}
```

内置策略建议（可组合）：
- `networkIdle(ms)`：inflight=0 且持续 ms
- `timeout(ms)`：硬超时
- `domStable(ms)`：可选（需要实现侧提供 dom 事件/探针，不是必须）
- `manual()`：由调用方显式 stop

---

## 11. PageSnapshot（快照输出）

### 11.1 数据结构
```ts
interface PageSnapshot {
  version: '1.0'
  createdAt: number
  url: string
  title?: string

  entry: string              // e.g. "index.html"
  files: SnapshotFile[]      // virtual filesystem

  // 可选：统计与调试信息
  meta?: {
    totalBytes?: number
    totalFiles?: number
    warnings?: string[]
  }

  // 关联的 content store（writer 需要）
  content: ContentStoreHandle
}

interface SnapshotFile {
  path: string               // virtual relative path
  mimeType?: string
  size?: number
  source: ContentRef         // memory or store-ref

  // 可选：用于排障/映射
  originalUrl?: string
  resourceType?: ResourceType
  headers?: Record<string, string>
}
```

### 11.2 ContentStoreHandle
避免把 store 实例直接暴露给外部，但 writer 需要：
```ts
interface ContentStoreHandle {
  open(ref: ContentRef): Promise<ReadableStream<Uint8Array>>
  dispose?(): Promise<void>
}
```

> 简化实现：可以直接让 `PageSnapshot.content` 引用 `ContentStore` 的最小子集。

---

## 12. Writers（输出适配器）

### 12.1 FS Writer（Node）
```ts
async function writeToFS(snapshot: PageSnapshot, outDir: string, options?: WriteFSOptions): Promise<WriteResult>
```

约束：
- 只做 IO，不触发网络，不依赖拦截器
- 对每个 file：`open(source)` → pipe 到 `outDir + file.path`

### 12.2 Zip Writer
```ts
async function toZip(snapshot: PageSnapshot, options?: ZipOptions): Promise<Uint8Array | Blob>
```

### 12.3 清理
调用者可选择在写完后清理：
```ts
await writeToFS(snapshot, './out')
await snapshot.content.dispose?.()
```

或通过 PageSnapshot 的 convenience 方法：
```ts
await snapshot.toDirectory('./out')
```

---

## 13. PagePocket.capture 生命周期（规范）

### 13.1 推荐流程
1. 创建 NetworkStore（包含 ContentStore、PathResolver、Filter）
2. `interceptor.start(target, handlers)`
3. 如需要导航：
   - 若 target.kind === 'url' 且 session.navigate 存在：调用 navigate(url)
   - 否则由实现方/调用方保证页面已在目标 url
4. 等待 completion strategies（networkIdle/timeout/...)
5. 停止拦截：`session.stop()`
6. 生成快照：
   - 入口 HTML 选择：优先 `resourceType=document` 的主 frame
   - 重写入口：把引用改为虚拟路径
   - 产出 `PageSnapshot(entry, files, contentHandle)`
7. 返回 snapshot

### 13.2 严格约束
- `capture()` 完成时：
  - 网络拦截已经停止
  - snapshot 的 file list 是稳定的
- writer 阶段不得触发任何网络请求

---

## 14. 对 Puppeteer / CDP 拦截器的兼容点（设计层面）

### 14.1 PuppeteerInterceptorAdapter
- target 通常为：
  - `{kind:'url', url}` 或 `{kind:'puppeteer-page', page}`
- capabilities 通常：
  - `canGetResponseBody = true`
  - `providesResourceType = true`

### 14.2 CDPInterceptorAdapter（Node 或 Extension）
- target 通常为：
  - `{kind:'cdp-session', session}` 或 `{kind:'cdp-tab', tabId}`
- capabilities 通常：
  - `canGetResponseBody = true`（通过 `Network.getResponseBody`）
  - `providesResourceType = true`
- 注意：Extension 场景下 PagePocket 应运行在 background/service worker（设计上不限制，但实现上需要）

> 关键：两者只要都能输出统一的 NetworkEvent 流，就能被 PagePocket 透明消费。

---

## 15. 典型使用示例（仅展示设计意图）

### 15.1 Node + Puppeteer
```ts
const pp = PagePocket.fromURL('https://example.com')

const snapshot = await pp.capture({
  interceptor: new PuppeteerInterceptorAdapter(/* ... */),
  completion: [networkIdle(800), timeout(30_000)],
})

await snapshot.toDirectory('./out')
await snapshot.content.dispose?.()
```

### 15.2 Chrome Extension + CDP(tab)
```ts
const pp = PagePocket.fromTarget({ kind: 'cdp-tab', tabId })

const snapshot = await pp.capture({
  interceptor: new CDPInterceptorAdapter(/* uses chrome.debugger */),
  completion: [networkIdle(800), timeout(30_000)],
})

// extension 中可选择 zip 或写入 OPFS/IDB（writer 可插拔）
const zip = await snapshot.toZip()
await snapshot.content.dispose?.()
```

---

## 16. 版本化与兼容性

- `PageSnapshot.version` 必须存在
- 未来升级：
  - 新增字段只增不删
  - body source 扩展不破坏 writer（writer 只依赖 open(ref)）

---

## 17. 最重要的设计约束（总结）

1. **NetworkInterceptorAdapter 输出事件，不输出文件。**
2. **Path 是虚拟相对路径，不是落地路径。**
3. **capture 阶段触发网络拦截；writer 阶段纯 IO。**
4. **大资源不要求常驻内存：通过 ContentStore(open/put) 解决。**
5. **Puppeteer/CDP 的差异由 adapter 吸收，通过 capabilities 适配。**
