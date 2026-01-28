import { once } from "node:events";
import http from "node:http";

import { CdpAdapter } from "@pagepocket/cdp-adapter";
import type { NetworkEvent, NetworkRequestEvent, NetworkResponseEvent } from "@pagepocket/lib";
import { chromium, expect, test, type CDPSession } from "@playwright/test";

const createServiceWorkerServer = async () => {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SW Fixture</title>
  </head>
  <body>
    <h1>Service Worker Fixture</h1>
    <script>
      window.__swReady = false;
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
          .then(() => navigator.serviceWorker.ready)
          .then(() => {
            window.__swReady = true;
          })
          .catch(() => {
            window.__swReady = 'error';
          });
      } else {
        window.__swReady = 'unsupported';
      }
    </script>
  </body>
</html>`;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    if (url === "/sw.js") {
      const sw = `self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/sw-data') {
    event.respondWith(new Response('from-sw', {
      headers: { 'Content-Type': 'text/plain' }
    }));
    return;
  }
  if (url.pathname === '/sw-json') {
    event.respondWith(new Response(JSON.stringify({ source: 'sw' }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }
});`;
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Service-Worker-Allowed": "/"
      });
      res.end(sw);
      return;
    }

    if (url === "/sw-data") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("from-network");
      return;
    }

    if (url === "/sw-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ source: "network" }));
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

const createEventWaiter = (predicate: (event: NetworkEvent) => boolean) => {
  let resolver: ((event: NetworkEvent) => void) | null = null;
  let rejecter: ((error: Error) => void) | null = null;

  const promise = new Promise<NetworkEvent>((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  });

  const push = (event: NetworkEvent) => {
    if (!predicate(event)) return;
    resolver?.(event);
  };

  const withTimeout = async (timeoutMs: number) => {
    const timeout = setTimeout(() => {
      rejecter?.(new Error("Timed out waiting for response event."));
    }, timeoutMs);
    try {
      return await promise;
    } finally {
      clearTimeout(timeout);
    }
  };

  return { push, wait: withTimeout };
};

test.describe("cdp-adapter with service worker responses", () => {
  let server: http.Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    const started = await createServiceWorkerServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test("captures response flagged as from service worker", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as any).__swReady === true);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const cdpSession: CDPSession = await context.newCDPSession(page);
    const adapter = new CdpAdapter();
    const waiter = createEventWaiter(
      (event) => event.type === "response" && event.url.endsWith("/sw-data")
    );

    const interceptSession = await adapter.start(
      { kind: "cdp-session", session: cdpSession as unknown },
      {
        onEvent: (event) => waiter.push(event)
      }
    );

    await page.evaluate(() => fetch("/sw-data"));

    const responseEvent = (await waiter.wait(10_000)) as NetworkResponseEvent;
    expect(responseEvent.fromServiceWorker).toBe(true);

    await interceptSession.stop();
    await context.close();
    await browser.close();
  });

  test("captures request/response metadata for service worker fetches", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as any).__swReady === true);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const cdpSession: CDPSession = await context.newCDPSession(page);
    const adapter = new CdpAdapter();
    const requestWaiter = createEventWaiter(
      (event) => event.type === "request" && event.url.endsWith("/sw-json")
    );
    const responseWaiter = createEventWaiter(
      (event) => event.type === "response" && event.url.endsWith("/sw-json")
    );

    const interceptSession = await adapter.start(
      { kind: "cdp-session", session: cdpSession as unknown },
      {
        onEvent: (event) => {
          requestWaiter.push(event);
          responseWaiter.push(event);
        }
      }
    );

    await page.evaluate(() => fetch("/sw-json"));

    const requestEvent = (await requestWaiter.wait(10_000)) as NetworkRequestEvent;
    const responseEvent = (await responseWaiter.wait(10_000)) as NetworkResponseEvent;

    expect(responseEvent.fromServiceWorker).toBe(true);
    expect(requestEvent.resourceType).toBe("fetch");
    expect(responseEvent.mimeType).toBe("application/json");

    await interceptSession.stop();
    await context.close();
    await browser.close();
  });
});
