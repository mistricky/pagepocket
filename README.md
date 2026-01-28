<p align="center">

<img src="/doc/logo.png" width="500" alt="Neovim" />

</p>

# PagePocket

PagePocket captures a web page as an offline snapshot. It fetches HTML, records
network activity, downloads assets, rewrites links to local files, and injects a
replay script so the snapshot runs without a network connection.

## Packages

- `@pagepocket/cli`: CLI for capturing snapshots.
- `@pagepocket/lib`: HTML rewrite and replay injection library.
- `@pagepocket/cdp-adapter`: Chrome DevTools Protocol adapter (for extension/service worker capture).
- `@pagepocket/lighterceptor`: jsdom-based request capture engine.
- `@pagepocket/uni-fs`: Node + OPFS filesystem helpers.

## Install

Install the CLI globally:

```bash
npm i -g @pagepocket/cli
```

## Usage

```bash
pp https://example.com
pp https://example.com -o ./snapshots
```

## Output

Snapshots are written to the current directory by default:

- `*.html`: offline snapshot page
- `*.requests.json`: recorded requests/responses
- `*_files/`: downloaded static assets

Example output paths:

- `example.html`
- `example.requests.json`
- `example_files/`
- `snapshots/example.html`
- `snapshots/example.requests.json`
- `snapshots/example_files/`

## How it works

1. **Fetch HTML**
   Uses a Node-side request to grab the initial HTML.
2. **Capture network**
   Runs `@pagepocket/lighterceptor` to collect request/response metadata.
3. **Download + rewrite**
   `@pagepocket/lib` downloads assets, rewrites HTML/CSS/JS references to local
   URLs, and injects replay/preload scripts.
4. **Write files**
   Writes `*.html`, `*.requests.json`, and the `*_files/` assets folder.

## Configuration

Environment variables:

- `PAGEPOCKET_FETCH_TIMEOUT_MS` (default: `60000`)
- `PAGEPOCKET_FETCH_HEADERS` (JSON string of extra headers)

## Development

```bash
pnpm install
pnpm -r build
```

Run adapter tests:

```bash
pnpm -F @pagepocket/cdp-adapter test
```
