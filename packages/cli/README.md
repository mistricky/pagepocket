# @pagepocket/cli

CLI for capturing offline snapshots of web pages using the PagePocket library and
NetworkInterceptorAdapter event streams.

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

Snapshots are written to a folder named after the page title (or `snapshot`) inside
the output directory (default: current directory). Example layout:

```
<output>/<title>/index.html
<output>/<title>/api.json
<output>/<title>/<same-origin paths>
<output>/<title>/external_resources/<cross-origin paths>
```

## Development

```bash
pnpm install
pnpm --filter @pagepocket/cli build
```
