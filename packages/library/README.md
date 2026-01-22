# @pagepocket/lib

Library for rewriting captured HTML into an offline-ready snapshot. It downloads
assets, rewrites HTML/CSS/JS references to local URLs, and injects replay/preload
scripts.

## Install

```bash
pnpm add @pagepocket/lib
```

## Quick Start

```ts
import { PagePocket } from "@pagepocket/lib";

const pagepocket = new PagePocket(htmlString, requestsJSON, {
  assetsDirName: "example_files",
  baseUrl: "https://example.com",
  requestsPath: "example.requests.json"
});

const html = await pagepocket.put();
```

## API

```ts
type PagePocketOptions = {
  assetsDirName?: string;
  baseUrl?: string;
  requestsPath?: string;
};
```

- `assetsDirName`: folder name for downloaded assets.
- `baseUrl`: used to resolve relative URLs.
- `requestsPath`: path to the `*.requests.json` file referenced by replay.

`put()` returns the rewritten HTML string.

## Notes

- Uses `@pagepocket/uni-fs` for file IO so it works in Node and OPFS contexts.
