import path from "node:path";

import { chromium, expect, test, type Page } from "@playwright/test";

const targetUrl = "https://ciechanow.ski/moon/";
const saveDir = "pagepocket-moon";

const gotoWithRetry = async (page: Page, url: string, attempts = 3) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError;
};

async function waitForSaveMessage(page: Page) {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Timed out waiting for save completion."));
      }, 60_000);

      const handler = (event) => {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (!data || data.type === "PAGEPOCKET_SAVE_FAILED") {
          window.clearTimeout(timeout);
          window.removeEventListener("message", handler);
          reject(new Error(data?.error || "Save failed."));
          return;
        }
        if (data.type !== "PAGEPOCKET_SAVE_DONE") {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve(data);
      };

      window.addEventListener("message", handler);
      window.postMessage({ type: "PAGEPOCKET_SAVE" }, "*");
    });
  });
}

test("chrome extension saves moon page to OPFS", async () => {
  const extensionPath = path.resolve(process.cwd(), "e2e", "extension");

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    chromiumSandbox: false,
    args: [
      "--disable-setuid-sandbox",
      "--disable-seccomp-filter-sandbox",
      "--disable-namespace-sandbox",
      "--no-zygote",
      "--disable-crash-reporter",
      "--disable-crashpad",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const page = await context.newPage();
    await gotoWithRetry(page, targetUrl);

    await waitForSaveMessage(page);

    const opfsSummary = await page.evaluate(async (dirName) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(dirName);
      const topEntries = [];
      for await (const [name, handle] of dir.entries()) {
        topEntries.push({ name, kind: handle.kind });
      }

      let assetsCount = 0;
      try {
        const assetsDir = await dir.getDirectoryHandle("assets");
        for await (const _ of assetsDir.entries()) {
          assetsCount += 1;
        }
      } catch {
        assetsCount = 0;
      }

      const manifestHandle = await dir.getFileHandle("manifest.json");
      const manifestText = await (await manifestHandle.getFile()).text();
      const manifest = JSON.parse(manifestText);

      const indexHandle = await dir.getFileHandle("index.html");
      const indexSize = (await indexHandle.getFile()).size;

      return { topEntries, assetsCount, manifest, indexSize };
    }, saveDir);

    expect(opfsSummary.indexSize).toBeGreaterThan(10_000);
    expect(opfsSummary.assetsCount).toBeGreaterThan(5);
    expect(opfsSummary.manifest.url).toContain(targetUrl);
    expect(opfsSummary.topEntries.map((entry) => entry.name).sort()).toEqual(
      expect.arrayContaining(["assets", "index.html", "manifest.json"])
    );
  } finally {
    await context.close();
  }
});
