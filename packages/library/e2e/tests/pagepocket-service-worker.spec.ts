import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

import { CdpAdapter } from "@pagepocket/cdp-adapter";
import type { NetworkEvent } from "@pagepocket/lib";
import { chromium, expect, test, type CDPSession, type Page } from "@playwright/test";
import { build } from "esbuild";

const createServer = async (bundlePath: string) => {
  const bundleContent = await fs.readFile(bundlePath, "utf8");
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgM+1H+YAAAAASUVORK5CYII=",
    "base64"
  );

  const serviceWorkerScript = `import { PagePocket } from '/sw/pagepocket-bundle.mjs';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const ensureUint8Array = (value) => {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (value?.data && Array.isArray(value.data)) return new Uint8Array(value.data);
  return new Uint8Array();
};

const normalizeEvents = (events) =>
  events.map((event) => {
    if (event?.type !== 'response' || !event.body) return event;
    if (event.body.kind === 'buffer') {
      return {
        ...event,
        body: {
          kind: 'buffer',
          data: ensureUint8Array(event.body.data)
        }
      };
    }
    return event;
  });

const clearDirectory = async (root, name) => {
  try {
    await root.removeEntry(name, { recursive: true });
  } catch {
    // Ignore missing directory.
  }
};

const createReplayAdapter = (events) => ({
  name: 'replay',
  capabilities: {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: true
  },
  async start(_target, handlers) {
    for (const event of events) {
      handlers.onEvent(event);
    }
    return {
      async stop() {}
    };
  }
});

self.addEventListener('message', async (event) => {
  const payload = event.data;
  if (!payload || payload.type !== 'PAGEPOCKET_CAPTURE') {
    return;
  }

  const source = event.source;
  try {
    const root = await navigator.storage.getDirectory();
    await clearDirectory(root, payload.outDir);

    const replay = createReplayAdapter(normalizeEvents(payload.events));
    const snapshot = await PagePocket.fromURL(payload.entryUrl).capture({
      interceptor: replay
    });

    const result = await snapshot.toDirectory(payload.outDir);
    source?.postMessage({ type: 'PAGEPOCKET_DONE', result });
  } catch (error) {
    source?.postMessage({ type: 'PAGEPOCKET_FAILED', error: String(error) });
  }
});`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>PagePocket SW</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <h1>PagePocket SW</h1>
    <img src="/images/pixel.png" alt="pixel" />
    <script src="/app.js"></script>
    <script>
      window.__swReady = false;
      if ('serviceWorker' in navigator) {
        const timeout = setTimeout(() => {
          if (window.__swReady === false) {
            window.__swReady = 'timeout';
          }
        }, 10000);
        navigator.serviceWorker.register('/sw/pagepocket-sw.js', { type: 'module', scope: '/' })
          .then(() => {
            window.__swReady = true;
            clearTimeout(timeout);
          })
          .catch(() => {
            window.__swReady = 'error';
            clearTimeout(timeout);
          });
      }
    </script>
  </body>
</html>`;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    if (url === "/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end("body { font-family: sans-serif; }");
      return;
    }
    if (url === "/app.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end("fetch('/api/data').catch(() => {});");
      return;
    }
    if (url === "/api/data") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === "/images/pixel.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(pixel);
      return;
    }
    if (url === "/sw/pagepocket-bundle.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundleContent);
      return;
    }
    if (url === "/sw/pagepocket-sw.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Service-Worker-Allowed": "/"
      });
      res.end(serviceWorkerScript);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl };
};

const buildBundle = async (outDir: string) => {
  await fs.mkdir(outDir, { recursive: true });
  const outfile = path.join(outDir, "pagepocket-bundle.mjs");
  await build({
    entryPoints: [path.resolve(process.cwd(), "src", "index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    outfile,
    logLevel: "silent",
    external: ["node:path", "node:fs/promises", "node:os"]
  });
  return outfile;
};

const collectEvents = async (
  adapter: CdpAdapter,
  session: CDPSession,
  run: () => Promise<void>
): Promise<NetworkEvent[]> => {
  const events: NetworkEvent[] = [];
  const interceptSession = await adapter.start(
    { kind: "cdp-session", session: session as unknown },
    {
      onEvent: (event) => {
        events.push(event);
      }
    }
  );

  await run();
  await interceptSession.stop();

  const hydrated: NetworkEvent[] = [];
  for (const event of events) {
    if (event.type === "response" && event.body && event.body.kind === "late") {
      const data = await event.body.read();
      hydrated.push({
        ...event,
        body: {
          kind: "buffer",
          data: new Uint8Array(data)
        }
      });
      continue;
    }
    hydrated.push(event);
  }

  return hydrated;
};

const waitForServiceWorker = async (page: Page) => {
  await page.waitForFunction(
    () =>
      (window as any).__swReady === true ||
      (window as any).__swReady === "error" ||
      (window as any).__swReady === "timeout",
    undefined,
    { timeout: 15_000 }
  );
  const swReady = await page.evaluate(() => (window as any).__swReady);
  if (swReady !== true) {
    throw new Error(`Service worker registration failed: ${String(swReady)}`);
  }
  await page.reload({ waitUntil: "networkidle" });
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const active = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg?.active;
    });
    if (active) {
      return;
    }
    await page.waitForTimeout(500);
  }
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      hasRegistration: !!reg,
      installing: reg?.installing?.state ?? null,
      waiting: reg?.waiting?.state ?? null,
      active: reg?.active?.state ?? null,
      activeScriptUrl: reg?.active?.scriptURL ?? null
    };
  });
  throw new Error(`Service worker did not become active: ${JSON.stringify(state)}`);
};

const requestCaptureInServiceWorker = async (
  page: Page,
  payload: { events: NetworkEvent[]; entryUrl: string; outDir: string }
) => {
  return page.evaluate((data) => {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Timed out waiting for service worker capture."));
      }, 30_000);

      const handler = (event: MessageEvent) => {
        const message = event.data;
        if (!message) return;
        if (message.type === "PAGEPOCKET_FAILED") {
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("message", handler as any);
          reject(new Error(message.error || "Service worker capture failed."));
          return;
        }
        if (message.type !== "PAGEPOCKET_DONE") {
          return;
        }
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler as any);
        resolve(message.result);
      };

      navigator.serviceWorker.addEventListener("message", handler as any);
      navigator.serviceWorker.getRegistration().then((registration) => {
        const worker = registration?.active;
        if (!worker) {
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("message", handler as any);
          reject(new Error("Active service worker not found."));
          return;
        }
        worker.postMessage({
          type: "PAGEPOCKET_CAPTURE",
          events: data.events,
          entryUrl: data.entryUrl,
          outDir: data.outDir
        });
      });
    });
  }, payload);
};

const listOpfsFiles = async (page: Page, outDir: string) => {
  return page.evaluate(async (dirName) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(dirName);

    const files: string[] = [];
    const walk = async (handle: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, child] of handle.entries()) {
        const next = prefix ? `${prefix}/${name}` : name;
        if (child.kind === "directory") {
          await walk(child, next);
        } else {
          files.push(next);
        }
      }
    };

    await walk(dir, "");
    return files.sort();
  }, outDir);
};

const OUT_DIR = "pagepocket-sw-output";

test("PagePocket runs in service worker and writes snapshot to OPFS", async () => {
  const bundleOutDir = path.resolve(process.cwd(), "e2e", ".cache");
  const bundlePath = await buildBundle(bundleOutDir);
  const { server, baseUrl } = await createServer(bundlePath);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await waitForServiceWorker(page);

    const cdpSession = await context.newCDPSession(page);
    const adapter = new CdpAdapter();

    const events = await collectEvents(adapter, cdpSession, async () => {
      await page.reload({ waitUntil: "networkidle" });
    });

    await requestCaptureInServiceWorker(page, {
      events,
      entryUrl: `${baseUrl}/index.html`,
      outDir: OUT_DIR
    });

    const files = await listOpfsFiles(page, OUT_DIR);

    expect(files).toEqual(
      expect.arrayContaining(["api.json", "app.js", "images/pixel.png", "index.html", "styles.css"])
    );
    expect(files.length).toBeGreaterThanOrEqual(5);
  } finally {
    await context.close();
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
