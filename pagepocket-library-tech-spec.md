# PagePocket Library Refactor Tech Spec

## Scope
- **Only** `packages/library` is in scope.
- `packages/cli` and other packages are out of scope.
- Must follow `pagepocket-design.md` exactly, plus the additional requirements confirmed in this thread.

## Goals
- Replace the current library API with the new `PagePocket.fromURL/fromTarget` + `capture()` flow (no backward compatibility).
- Use `NetworkInterceptorAdapter` events as the **only** source of network data.
- Persist resources into a virtual snapshot that can be written later by writers.
- Produce snapshot layout:
  - `index.html` (entry)
  - `/...resources` (same-path storage for same-origin resources)
  - `/external_resources/...` (same-path storage for cross-origin resources)
  - `api.json` (recorded fetch/xhr request/response data)
- Rewrite HTML/CSS/JS so requests resolve to **absolute paths** under the snapshot root.

## Non-Goals
- No changes in `packages/cli`.
- No additional behavior for SPA route discovery.
- No automatic runtime execution beyond the capture lifecycle.

---

## High-Level Architecture

### Modules (library)
- **PagePocket (orchestrator)**
  - Owns lifecycle: start interceptor → wait completion → stop → build snapshot.
- **NetworkStore (aggregator)**
  - Correlates request/response by `requestId`.
  - Applies filters/limits.
  - Resolves virtual paths via `PathResolver`.
  - Writes bodies into `ContentStore`.
- **Rewriter**
  - Rewrites entry HTML and captured CSS/JS references to snapshot absolute paths.
- **ContentStore**
  - Stores bodies as `ContentRef` (memory or store-ref).
- **Writers**
  - FS/Zip/OPFS style output; pure IO, no network.

### Data Flow
```
Interceptor → NetworkEvent stream → NetworkStore + ContentStore → PageSnapshot → Writer
```

---

## Public API

### PagePocket
```ts
class PagePocket {
  static fromURL(url: string, options?: PagePocketOptions): PagePocket
  static fromTarget(target: InterceptTarget, options?: PagePocketOptions): PagePocket
  capture(options?: CaptureOptions): Promise<PageSnapshot>
}
```

### PagePocketOptions
```ts
interface PagePocketOptions {
  // future-proof placeholder; currently minimal
}
```

### CaptureOptions
```ts
interface CaptureOptions {
  interceptor: NetworkInterceptorAdapter
  completion?: CompletionStrategy | CompletionStrategy[]
  filter?: ResourceFilter
  pathResolver?: PathResolver
  contentStore?: ContentStore
  rewriteEntry?: boolean
  rewriteCSS?: boolean
  limits?: {
    maxTotalBytes?: number
    maxSingleResourceBytes?: number
    maxResources?: number
  }
}
```

---

## NetworkInterceptorAdapter

### Target
```ts
type InterceptTarget =
  | { kind: 'url'; url: string }
  | { kind: 'puppeteer-page'; page: unknown }
  | { kind: 'cdp-tab'; tabId: number }
  | { kind: 'cdp-session'; session: unknown }
```

### Adapter Interface
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

### Capabilities
```ts
interface InterceptorCapabilities {
  canGetResponseBody: boolean
  canStreamResponseBody: boolean
  canGetRequestBody: boolean
  providesResourceType: boolean
}
```

### InterceptSession
```ts
interface InterceptSession {
  navigate?(url: string, options?: NavigateOptions): Promise<void>
  stop(): Promise<void>
}
```

### Important Behavior
- **No auto-fetch in core**. If an interceptor needs to actively fetch (e.g. Lighterceptor), it must do so **inside its adapter implementation** and emit `NetworkResponseEvent` with body.
- Puppeteer/CDP adapters should use native response bodies and must not fetch separately.

---

## Standardized Events

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

---

## Snapshot Layout (Writer Output)

### Root
```
/index.html
/api.json
/<same-origin resource paths>
/external_resources/<cross-origin resource paths>
```

### Same-Origin Resource Paths
- Resources from the **same origin** as the original capture URL are stored using their **URL path**, directly under root.
- Example:
  - Original URL: `https://transformer-circuits.pub/2025/attribution-graphs/png/img_072a671aa71b862c.png`
  - Saved path: `/2025/attribution-graphs/png/img_072a671aa71b862c.png`

### External Resources
- Any resource whose **domain differs** from the original capture URL is considered external
  (domain comparison ignores port).
- Saved under `/external_resources/<url path>`.
- Example:
  - External URL: `https://cdn.example.com/assets/a/b.png`
  - Saved path: `/external_resources/assets/a/b.png`

### Entry
- When a single document is captured, it is saved as `/index.html`.
- When multiple documents are captured, **each document must be written to its own output
  directory**, each containing its own `index.html` and associated resources.
- **Directory naming rule:** use the document URL **path** to generate the directory name.
  - Example: `https://example.com/foo/bar` → `foo/bar/` (normalized to POSIX, no leading slash).
  - If the path is `/` or empty, use `root/`.
  - If the path ends with a file name, keep it as part of the directory path.

### `api.json`
- New JSON schema (see below) storing fetch/xhr details.

---

## URL Rewriting Requirements

### Scope
- Rewrite **HTML, CSS, and JS** references.
- All rewritten URLs must be **absolute paths** from the snapshot root (e.g. `/2025/...`, `/external_resources/...`).

### Targets
- HTML attributes: `src`, `href`, `poster`, `data-*` where relevant, `srcset` entries, `link[rel=preload|prefetch|modulepreload]`, `meta` refresh URLs, etc.
- CSS `url(...)` and `@import`.
- JS string literals for import specifiers, and optionally known fetch/XHR patterns (see below).

### Rules
- Same-origin URLs → `/` + original pathname + query preserved only if the resource itself is saved with query distinction.
- Cross-origin URLs → `/external_resources/` + original pathname (query handling defined below).
- In-snapshot references (already absolute under `/` or `/external_resources/`) must be preserved.

### Query Handling
- Snapshot paths must be **deterministic** and **cannot ignore query/hash**.
- The stored path **must distinguish** resources that differ by query or hash.
- PathResolver and rewrite logic must apply the **same** mapping.

---

## PathResolver Strategy

### Contract
```ts
interface PathResolver {
  resolve(input: {
    url: string
    resourceType?: ResourceType
    mimeType?: string
    suggestedFilename?: string
    isCrossOrigin: boolean
    entryUrl: string
  }): string
}
```

### Required Default Behavior
- Entry document → `index.html`.
- Same-origin resource → `/<pathname>` (cross-origin check compares **domain only**, ignores port).
- Cross-origin resource → `/external_resources/<pathname>`.
- All output paths are **POSIX**, absolute from snapshot root, and contain no `..`.

### Deduplication & Collisions
- If the same pathname appears multiple times (including query/hash differences), the path
  must be made unique via a stable suffix (e.g. hash) to prevent collisions.

---

## ResourceFilter

### Contract
```ts
interface ResourceFilter {
  shouldSave(req: NetworkRequestEvent, res?: NetworkResponseEvent): boolean
}
```

### Default Recommendations
- Save resource types: document, stylesheet, script, image, font, media.
- Save xhr/fetch **only** for `api.json` and replay (not as files).
- Skip `status >= 400` by default (configurable).

---

## ContentStore

### Contract
```ts
type ContentRef =
  | { kind: 'memory'; data: Uint8Array }
  | { kind: 'store-ref'; id: string }

interface ContentStore {
  name: string
  put(body: BodySource, meta: { url: string; mimeType?: string; sizeHint?: number }): Promise<ContentRef>
  open(ref: ContentRef): Promise<ReadableStream<Uint8Array>>
  dispose?(): Promise<void>
}
```

### Default Implementation
- `HybridContentStore`:
  - Small bodies in memory.
  - Large bodies in temp storage.

---

## NetworkStore Responsibilities

### Inputs
- NetworkEvent stream (request/response/failed).
- `ResourceFilter`, `PathResolver`, `ContentStore`, limits.

### Outputs
- `SnapshotFile[]` with `ContentRef` and metadata.
- Entry HTML content.
- `api.json` data.

### Behavior
- Correlate request+response by `requestId`.
- Determine resource type and save policy.
- For saved resources:
  - Compute virtual path via `PathResolver`.
  - Put body into `ContentStore`.
  - Emit `SnapshotFile` with `originalUrl`, `mimeType`, `size`, `headers`.
- For fetch/xhr:
  - Extract request/response details into `api.json` schema.

---

## api.json Schema (New)

```ts
interface ApiRecord {
  url: string
  method: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyBase64?: string
  requestEncoding?: 'text' | 'base64'
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  responseBodyBase64?: string
  responseEncoding?: 'text' | 'base64'
  error?: string
  timestamp: number
}

interface ApiSnapshot {
  version: '1.0'
  url: string
  createdAt: number
  records: ApiRecord[]
}
```

### Notes
- Only fetch/xhr requests go into this file.
- Bodies are stored as text when UTF-8 safe; otherwise base64.
- `api.json` is added to `PageSnapshot.files` as a normal file.

---

## Rewriter Requirements

### Entry HTML
- Rewrite all relevant resource references to **absolute snapshot paths**.
- Inject `api.json` hook and the existing replay/preload scripts (keep current behavior).

### CSS
- Rewrite all `url(...)` and `@import` to absolute snapshot paths.

### JS
- Rewrite module import specifiers and other recognized asset URL literals.
- Follow the **existing hack-based approach** from the current library implementation.
- Do **not** attempt to parse or execute JS; only static string-based rewriting.

---

## PageSnapshot

```ts
interface PageSnapshot {
  version: '1.0'
  createdAt: number
  url: string
  title?: string
  entry: string
  files: SnapshotFile[]
  meta?: {
    totalBytes?: number
    totalFiles?: number
    warnings?: string[]
  }
  content: ContentStoreHandle
  toDirectory(outDir: string, options?: WriteFSOptions): Promise<WriteResult>
  toZip(options?: ZipOptions): Promise<Uint8Array | Blob>
}
```

---

## Writers

### FS Writer
- Pure IO; no network.
- For each `SnapshotFile`:
  - `open(ref)` → stream to `outDir + file.path`.

### Zip Writer
- Pure IO; no network.
- Preserve full virtual path inside zip.

---

## Capture Lifecycle

1. Initialize `NetworkStore` with `ContentStore`, `PathResolver`, `ResourceFilter`.
2. `interceptor.start(target, handlers)`.
3. If `target.kind === 'url'` and session supports `navigate`, call `navigate(url)`.
4. Wait for `CompletionStrategy` (e.g. networkIdle + timeout).
5. `session.stop()`.
6. Build snapshot:
   - If multiple document responses exist, **each document becomes its own output directory**
     with its own `index.html` and associated resources.
   - Choose entry document content per document group.
   - Run rewriter on entry HTML and captured CSS/JS.
   - Add rewritten entry + resources + `api.json` to `files`.
7. Return `PageSnapshot`.

---

## Implementation Plan (Library Only)

### Phase 1: Type System & Public API
- Replace `src/types.ts` with the new design types and interfaces.
- Replace `PagePocket` class with the new construction/capture API.
- Update `src/index.ts` exports to the new surface.

### Phase 2: NetworkStore & ContentStore
- Introduce `NetworkStore` module.
- Implement `ContentStore` (hybrid) with `ContentRef`.
- Implement default `PathResolver`:
  - Entry `index.html`.
  - Same-origin `/pathname`.
  - Cross-origin `/external_resources/pathname`.

### Phase 3: Rewriter Integration
- Reuse existing HTML/CSS/JS rewriting modules.
- Update rewrite logic to output **absolute snapshot paths**.
- Ensure rewrite applies to entry HTML and captured CSS/JS files.

### Phase 4: api.json
- Add generator for new schema.
- Include as file in `PageSnapshot.files`.
- Ensure replay hooks point at `/api.json`.

### Phase 5: Writers
- Implement `writeToFS` and `toZip` consistent with new `PageSnapshot`.
- Add convenience methods to `PageSnapshot`.

### Phase 6: Cleanup & Tests
- Update or add library specs to cover:
  - Path mapping (same-origin vs external).
  - Rewriting to absolute paths.
  - api.json generation and replay injection.
  - Snapshot output structure.
  - Multi-document output directories derived from URL paths.

---

## Open Questions (Must Resolve During Implementation)
- None (all rules specified in this document).

---

## Detailed Context for Implementation

### Current Library Surface (to be replaced)
- Existing entrypoint `packages/library/src/pagepocket.ts` implements `new PagePocket(html, requests).put()`.
- This **must be removed** and replaced with the new design API (`PagePocket.fromURL/fromTarget` + `capture()`).
- Existing modules for rewriting/hacking should be preserved and wired into the new flow:
  - `src/rewrite-links.ts`
  - `src/css-rewrite.ts`
  - `src/replay-script.ts`
  - `src/preload.ts`
  - `src/hackers/*`

### Current Data Sources (to be replaced)
- Existing `SnapshotData` and `CapturedNetworkRecord` are **legacy** and should not be part of the new API.
- `NetworkInterceptorAdapter` in the new design is the only input to `capture()`.

### New Output Structure (important)
- The snapshot is a **virtual filesystem** expressed by `PageSnapshot.files` with absolute POSIX paths.
- Writers are responsible for converting that virtual FS into actual output files.
- For multi-document captures:
  - Each document becomes a separate output directory.
  - The directory name is derived from the document URL **path** (normalized; `/` → `root/`).
  - Each directory contains its own `index.html`, `api.json`, and associated resources.

### Rewriter Integration Notes
- HTML/CSS/JS rewriting must generate **absolute paths** pointing to the virtual FS:
  - Same-origin: `/<pathname>` (or `/<dir>/<pathname>` when multi-document output is enabled).
  - Cross-origin: `/external_resources/<pathname>` (or `/<dir>/external_resources/<pathname>` for multi-doc).
- Rewriting should continue to rely on the existing hack-based approach (no heavy parsing).

### URL Normalization & Safety
- All output paths must be POSIX (forward slashes).
- `..` segments must be removed or sanitized.
- Leading slash is required in virtual snapshot paths (writer joins with outDir).
- Path naming must preserve query/hash distinctions by appending a stable suffix (e.g. hash).

### Multi-Document Grouping (Practical Guidance)
- Grouping is based on **document responses** (`resourceType: 'document'`).
- Each document group should include:
  - The document HTML.
  - All resources whose `request.initiator` or `frameId` indicates they belong to that document.
  - If the adapter cannot provide `frameId`, default to single-group behavior.

### api.json Scope
- Only records for `fetch`/`xhr` go into `api.json`.
- The rewriter must inject the replay hooks to use `/api.json` in each output directory.

### Adapter Responsibilities (Important)
- If an adapter requires active fetch (e.g. Lighterceptor), the adapter itself must do so.
- PagePocket core **never** performs fetch during capture.

---

## Acceptance Criteria
- Library exposes new API, with no backward compatibility.
- `capture()` uses only interceptor events for data.
- Snapshot output matches required structure and paths.
- HTML/CSS/JS rewritten to absolute snapshot paths.
- `api.json` captures fetch/xhr details and replay hook uses it.
- Writers perform pure IO; no network activity.
