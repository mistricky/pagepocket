# Websnap

Websnap is a webpage snapshot tool. Given a URL, it loads the page in a headless browser, records all requests/responses, and rewrites remote resources to local files so the page can be viewed offline.

## What it does

- Saves the page HTML to a local file.
- Records fetch/XHR requests and responses.
- Downloads static assets (scripts, styles, images, fonts, etc.).
- Replaces remote resource links with local files or inlined Data URLs to keep the snapshot self-contained.

## How it works

1. **Page load**  
   Uses Puppeteer to launch a headless browser and open the target URL.
2. **Request interception and recording**  
   Injects `src/preload.ts` into the page to wrap `fetch` and `XMLHttpRequest`, capturing request/response data in memory. In Node, it also listens to network responses to capture response bodies.
3. **Resource capture and rewrite**  
   Parses the HTML with Cheerio, extracts resource URLs (`script`, `link`, `img`, `srcset`, etc.), downloads them into a local folder, and rewrites HTML references to local paths.
4. **Replay script injection**  
   Injects a replay script into the output HTML that swaps remote requests for local or recorded data during offline viewing.

## Usage

```bash
pnpm install
pnpm build
pnpm start -- https://example.com
```

Outputs are written to the current directory:

- `*.html`: offline snapshot page
- `*.requests.json`: recorded requests/responses
- `*_files/`: downloaded static assets

## Code layout

- `src/cli.ts`: CLI entry point and snapshot pipeline
- `src/preload.ts`: browser-side recorder for fetch/XHR
- `dist/`: compiled output
