# @pagepocket/cli

CLI for capturing offline snapshots of web pages. It fetches HTML, records network
responses, downloads assets, rewrites links to local files, and injects a replay
script so the snapshot works offline.

## Install

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
- `*_files/`: downloaded assets

## Configuration

Environment variables:

- `PAGEPOCKET_FETCH_TIMEOUT_MS` (default: `60000`)
- `PAGEPOCKET_FETCH_HEADERS` (JSON string of extra headers)

## Development

```bash
pnpm install
pnpm --filter @pagepocket/cli build
```
