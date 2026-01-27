# @pagepocket/lib

Core library for capturing a page via NetworkInterceptorAdapter events and
producing a virtual snapshot (HTML/CSS/JS rewritten to absolute snapshot paths).
No network fetch happens in the core library.

## Install

```bash
pnpm add @pagepocket/lib
```

## Quick Start

```ts
import { PagePocket } from "@pagepocket/lib";
import { SomeInterceptorAdapter } from "@pagepocket/adapters";

const interceptor = new SomeInterceptorAdapter();
const snapshot = await PagePocket.fromURL("https://example.com").capture({
  interceptor
});

await snapshot.toDirectory("./out");
```

## API

```ts
class PagePocket {
  static fromURL(url: string, options?: PagePocketOptions): PagePocket;
  static fromTarget(target: InterceptTarget, options?: PagePocketOptions): PagePocket;
  capture(options?: CaptureOptions): Promise<PageSnapshot>;
}
```

### CaptureOptions (core)

```ts
interface CaptureOptions {
  interceptor: NetworkInterceptorAdapter;
  completion?: CompletionStrategy | CompletionStrategy[];
  filter?: ResourceFilter;
  pathResolver?: PathResolver;
  contentStore?: ContentStore;
  rewriteEntry?: boolean;
  rewriteCSS?: boolean;
  limits?: {
    maxTotalBytes?: number;
    maxSingleResourceBytes?: number;
    maxResources?: number;
  };
}
```

### PageSnapshot output

```ts
interface PageSnapshot {
  version: "1.0";
  createdAt: number;
  url: string;
  entry: string;
  files: SnapshotFile[];
  toDirectory(outDir: string, options?: WriteFSOptions): Promise<WriteResult>;
  toZip(options?: ZipOptions): Promise<Uint8Array | Blob>;
}

interface WriteFSOptions {
  clearCache?: boolean;
}

interface ZipOptions {
  asBlob?: boolean;
  clearCache?: boolean;
}
```

Snapshot layout:

```
/index.html
/api.json
/<same-origin paths>
/external_resources/<cross-origin paths>
```

If multiple documents are captured, each document is written to its own output
directory based on the document URL path (e.g. `foo/bar/index.html`).

## Notes

- Uses `@pagepocket/uni-fs` for file IO so it works in Node and OPFS contexts.
- Network data comes only from the interceptor events.
