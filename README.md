
<p align="center">

<img src="/doc/logo.png" width="500" alt="Neovim" />

</p>

# PagePocket

PagePocket is a webpage snapshot tool. Given a URL, it loads the page in a headless browser, records network activity, and rewrites remote resources to local files so the page can be viewed offline.

## Highlights

- Captures the final HTML after the page settles.
- Records fetch/XHR request and response data for offline replay.
- Downloads static assets (scripts, styles, images, fonts, etc.).
- Rewrites resource links to local files or inlined Data URLs.
- Injects a replay script so the snapshot can run without a network connection.

## How it works

1. **Page load**
   Uses Puppeteer to launch a headless browser and open the target URL.
2. **Request interception and recording**
   Injects `src/preload.ts` into the page to wrap `fetch` and `XMLHttpRequest`, capturing request/response data in memory. In Node, it also listens to network responses to capture response bodies.
3. **Resource capture and rewrite**
   Parses the HTML with Cheerio, extracts resource URLs (`script`, `link`, `img`, `srcset`, etc.), downloads them into a local folder, and rewrites HTML references to local paths.
4. **Replay script injection**
   Injects a replay script into the output HTML that swaps remote requests for local or recorded data during offline viewing.

## Install

Install globally so the `pp` CLI is available in your shell:

```bash
npm i -g pagepocket
```

## Usage

```bash
pp https://example.com
pp https://example.com -o ./snapshots
```

## Output

Snapshots are written to the current directory by default.

Use `--output` to choose a different directory; filenames still derive from the page title:

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

## Configuration

These environment variables control timeouts:

- `PAGEPOCKET_NAV_TIMEOUT_MS`: navigation timeout for the initial page load (default: 60000)
- `PAGEPOCKET_PENDING_TIMEOUT_MS`: time to wait for tracked fetch/XHR activity to settle (default: 40000)

## Notes and limitations

- PagePocket records fetch/XHR traffic and DOM content, but it does not guarantee capture of every dynamic request if a site continuously streams data.
- Some sites require authentication or run strict CSP policies; you may need to load the page in a logged-in session or adjust your capture approach.
- Snapshots are intended for offline viewing and debugging, not for producing a perfect archival copy of every runtime behavior.
