# PagePocket Architecture and Mechanics

## 1. Goals and mental model

- **Objective**: Produce an offline-playable snapshot of any URL, including dynamic data fetched after initial load.
- **Two-phase design**: (1) **Capture** records what the page requested and what it received; (2) **Replay** serves the same responses and assets without touching the network.
- **Division of labor**: Node-side code (CLI + Puppeteer) performs orchestration and downloads assets; browser-side “hackers” patch runtime APIs to observe (during capture) and to override (during replay).

## 2. High-level architecture

- **CLI driver**: `src/cli.ts` (oclif) accepts `url` and optional `--output/-o` directory. It launches Puppeteer, injects preload code, applies capture hooks, gathers outputs, and writes snapshot artifacts. Filenames always derive from the page title; the output flag only sets the target directory.
- **Capture hackers (Node/Puppeteer)**: `capture-network` intercepts network responses to save headers/bodies (text or base64 for binaries).
- **Preload hackers (page context, pre-scripts)**: `preload-fetch`, `preload-xhr` wrap fetch/XHR to log request/response pairs and track pending activity.
- **Replay hackers (page context, replay)**: `replay-fetch`, `replay-xhr`, `replay-dom-rewrite`, and stubs for beacon/WebSocket/EventSource replace network access with recorded data and local assets.
- **Replay script builder**: `src/lib/replay-script.ts` embeds the necessary logic and hackers into the saved HTML, wiring everything up during offline viewing.
- **Resource processing**: `resources.ts`, `css-rewrite.ts` extract resource links, download them, rewrite HTML/CSS to point at local copies, and store metadata for replay.
- **Shared types and helpers**: `types.ts`, `filename.ts`, `content-type.ts` define data contracts and naming/content heuristics.

## 3. Capture phase: from navigation to artifacts

### 3.1 Bootstrap

- CLI resolves `targetUrl` and `outputFlag`, builds preload script (`buildPreloadScript`), and starts Puppeteer headless Chromium with navigation/pending timeouts.
- Applies capture hackers (`applyCaptureHackers` → `capture-network`), injects preload hackers (`preload-fetch`, `preload-xhr`) via `page.evaluateOnNewDocument`.

### 3.2 Page settling strategy

- Navigation waits for `domcontentloaded`, presence of `body`, `waitForNetworkIdle`, and a drain of `__pagepocketPendingRequests` (set by preload hackers), plus a small grace delay. This balances dynamic sites and prevents premature capture.

### 3.3 Request/response recording layers

- **Page-level (preload hackers)**
  - `preload-fetch`: wraps `window.fetch`, records method/URL/body, response headers/status/body (text), errors, and timestamps. Tracks pending counts.
  - `preload-xhr`: wraps XHR `open/send`, records method/URL/body, response headers/status/body (text), errors, and timestamps. Tracks pending counts via `loadend`.
  - Both store records on `window.__pagepocketRecords` and maintain `__pagepocketPendingRequests` for quiescence detection.
- **Browser-level (capture hacker)**
  - `capture-network`: enables request interception; on every Puppeteer `response`, captures request headers/body and response headers/body. Text bodies are UTF-8; binary bodies are base64 with an `responseEncoding` tag and optional error string.

### 3.4 HTML acquisition and resource discovery

- HTML chosen as initial response text (if available) or `page.content()` fallback. Title is extracted, sanitized by `safeFilename`, and used as the base name for all outputs.
- `extractResourceUrls` (Cheerio) collects `script`, `link` (stylesheet/icon), `img`, `source`, `video`, `audio`, and `srcset` candidates, absolutizes URLs against the page origin, and returns references for rewriting.

### 3.5 Asset download and CSS inlining

- For each discovered resource, `downloadResource` fetches with a referer header, naming files as SHA1(URL)+ext (ext inferred from URL or content-type). Metadata (contentType, size) is retained.
- CSS files are post-processed with `rewriteCssUrls` to inline `url(...)` references using a `dataUrlMap` built from recorded binary responses, increasing offline fidelity.
- A `resourceMap` (URL → filename) and `resourceMeta` list are built for replay and for DOM rewrites.

### 3.6 DOM rewriting for saved assets

- `applyResourceMapToDom` mutates HTML to point `src`, `href`, and `srcset` to local asset paths (`<title>_files/<hash>.<ext>`). This ensures first render of the saved HTML already uses local files.

### 3.7 Artifact emission

Given sanitized title `T` and output directory `D` (default `cwd`):

- HTML: `D/T.html` (includes replay script injection)
- Requests metadata: `D/T.requests.json` (snapshot of `SnapshotData`)
- Assets: `D/T_files/`

`snapshotData` structure (`types.ts`):

- `url`, `title`, `capturedAt`
- `fetchXhrRecords` (from preload hackers)
- `networkRecords` (from capture hacker)
- `resources` (`{ url, localPath, contentType?, size? }`)

## 4. Replay phase: turning recordings into an offline page

### 4.1 Bootstrapping

- Saved HTML loads with an injected `<script>` from `buildReplayScript(requestsPath, baseUrl)`. It binds the original `fetch` (before patching) to load `T.requests.json`, then primes lookup tables:
  - `byKey`: method+normalized URL+body → recorded response (fetch/XHR/network).
  - `resourceUrlMap`: original URL → local asset path.
  - `localResourceSet`: known local paths plus data/blob URLs for quick checks.
- Helpers: `normalizeUrl`, `normalizeBody`, `makeKey`, `findRecord`, `findLocalPath`, `toDataUrl`, `responseFromRecord`, base64 and text enc/dec utilities, `defineProp` for XHR state injection.

### 4.2 Runtime patching (replay hackers)

- **Fetch** (`replay-fetch`): overrides `window.fetch`; awaits readiness, finds matching record, returns synthetic `Response` (404 if missing).
- **XHR** (`replay-xhr`): overrides `open/send`; on `send`, finds record, sets readyState/status/response/responseText, fires events (`readystatechange`, `load`, `loadend`), supports arraybuffer/blob via base64 decoding; returns 404-like response when missing.
- **DOM rewrite** (`replay-dom-rewrite`):
  - Rewrites `src`, `href`, `srcset` to local assets or data URLs; uses placeholders (transparent GIF, empty JS/CSS) when absent.
  - Patches `setAttribute` and property setters for `img.src`, `script.src`, `link.href`, `img.srcset` to enforce local/data URL usage.
  - MutationObserver rewrites dynamically added nodes/attributes (`src`, `href`, `srcset`).
- **Network stubs**: `replay-beacon`, `replay-websocket`, `replay-eventsource` neutralize outbound traffic while preserving API surfaces.

### 4.3 Coverage of assets and inlined references

- DOM-level rewrites catch `src`/`href`/`srcset` both at load and dynamically.
- CSS-level rewrites (capture time) inline `url(...)` references to data URLs using recorded binary responses, covering assets referenced from stylesheets.
- Data URL generation (`toDataUrl`) respects recorded content-type and encoding (text vs. base64) to preserve media fidelity.

## 5. Abstractions and extension points

- **Hacker interface** (`hackers/types.ts`):
  - `ScriptHacker` (`stage: preload|replay`, `build(context) -> string`) injects JS into the page.
  - `CaptureHacker` (`stage: capture`, `apply(context)`) runs in Node/Puppeteer.
- **Registration**: `hackers/index.ts` exposes `preloadHackers`, `captureHackers`, `replayHackers` consumed by CLI (capture) and replay script builder.
- **Adding new capabilities**: implement a hacker with the right stage and register it. Examples: Service Worker capture/replay, WebRTC stubs, advanced caching heuristics.

## 6. Data contracts and fidelity guarantees

- **Fetch/XHR parity**: Requests matched by method + normalized URL + body; body-insensitive fallback keys ensure GET lookups succeed even without bodies.
- **Binary safety**: Binary responses stored as base64 with `responseEncoding: "base64"`; replay decodes to `Uint8Array`/`Blob` for XHR and to `Response` bodies for fetch.
- **Resource locality**: Local paths tracked in `resourceUrlMap` and `localResourceSet` ensure DOM rewrites and API patches do not leak to network.
- **Timeout tuning**: `PAGEPOCKET_NAV_TIMEOUT_MS`, `PAGEPOCKET_PENDING_TIMEOUT_MS` control navigation and pending-request waits, guarding against hangs and premature captures.

## 7. End-to-end control flow (concrete call chain)

1. User runs `pp <url> [-o <dir>]`.
2. `src/cli.ts` parses args/flags → builds preload script → launches Puppeteer.
3. `applyCaptureHackers` attaches `capture-network`; `page.evaluateOnNewDocument` installs `preloadHackers`.
4. Navigate and wait (DOM ready, idle, pending drain). Snapshot HTML + title acquired.
5. `extractResourceUrls` gathers asset refs → `downloadResource` fetches each → `rewriteCssUrls` inlines CSS URLs → `applyResourceMapToDom` rewrites HTML refs.
6. `SnapshotData` composed; replay script (`buildReplayScript`) injected; artifacts written (`T.html`, `T.requests.json`, `T_files/`).
7. Offline open of `T.html` → replay script loads JSON via original fetch → primes lookup maps → installs replay hackers → page code runs, hitting patched fetch/XHR/DOM, which resolve to recorded data/local assets; stubs block outbound network.

## 8. Files of interest (implementation map)

- Capture orchestration: `src/cli.ts`
- Preload hackers: `src/preload.ts`, `src/lib/hackers/preload-fetch.ts`, `preload-xhr.ts`
- Capture hacker: `src/lib/hackers/capture-network.ts`
- Replay builders/hackers: `src/lib/replay-script.ts`, `src/lib/hackers/replay-fetch.ts`, `replay-xhr.ts`, `replay-dom-rewrite.ts`, `replay-beacon.ts`, `replay-websocket.ts`, `replay-eventsource.ts`
- Resource handling: `src/lib/resources.ts`, `src/lib/css-rewrite.ts`, `src/lib/content-type.ts`, `src/lib/filename.ts`
- Types: `src/lib/types.ts`, hacker wiring: `src/lib/hackers/index.ts`

## 9. Operational guidance

- Output directory via `--output/-o`; names stay tied to sanitized title.
- Build with `pnpm build`; run with `pnpm start -- <url>` or `node dist/cli.js <url>` after building.
- Treat `*.html`, `*.requests.json`, `*_files/` as generated artifacts; keep `dist/` as compiled output.

## 10. Future expansion ideas

- Service Worker capture/replay; WebRTC and SSE fidelity.
- Smarter idle detection or heuristics for long-poll/streaming apps.
- Optional fixtures/tests to exercise capture→replay parity on known pages.
