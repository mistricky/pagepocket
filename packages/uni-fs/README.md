# @pagepocket/uni-fs

Unified filesystem helpers that work in Node and OPFS (Origin Private File System).

## Install

```bash
pnpm add @pagepocket/uni-fs
```

## API

```ts
import {
  write,
  readAsURL,
  readText,
  readBinary,
  exists,
  delete as deleteFile
} from "@pagepocket/uni-fs";

await write("snapshots/page", "html", "<html>...</html>");
const url = await readAsURL("snapshots/page", "html");
const text = await readText("snapshots/page", "html");
const bytes = await readBinary("snapshots/page", "html");
const ok = await exists("snapshots/page", "html");
await deleteFile("snapshots/page", "html");
```

## Behavior

- In browsers/Service Workers with OPFS, `readAsURL` returns a `data:` URL.
- In Node, `readAsURL` returns a file path beginning with `/`.
