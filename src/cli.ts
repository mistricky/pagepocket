#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { buildDataUrlMap, rewriteCssUrls } from "./lib/css-rewrite";
import { isTextResponse } from "./lib/content-type";
import { safeFilename } from "./lib/filename";
import { buildReplayScript } from "./lib/replay-script";
import { applyResourceMapToDom, downloadResource, extractResourceUrls } from "./lib/resources";
import type { NetworkRecord, SnapshotData } from "./lib/types";

const usage = () => {
  return "Usage: websnap <url>";
};

const main = async () => {
  const [targetUrl] = process.argv.slice(2);
  if (!targetUrl) {
    console.error(usage());
    process.exit(1);
  }

  // Load the preload script so it can record fetch/XHR data in the page context.
  const preloadPath = path.join(__dirname, "preload.js");
  const preloadScript = await fs.readFile(preloadPath, "utf-8");

  // Launch a headless browser to capture both DOM and network activity.
  const browser = await puppeteer.launch({
    headless: true
  });

  const page = await browser.newPage();
  await page.setRequestInterception(true);

  // Accumulate network traffic so the replay script can serve responses offline.
  const networkRecords: NetworkRecord[] = [];

  page.on("request", (request) => {
    request.continue().catch(() => undefined);
  });

  page.on("response", async (response) => {
    const request = response.request();
    const url = response.url();
    const headers = response.headers();
    const requestHeaders = request.headers();
    const requestBody = request.postData() || "";

    // Capture the response body while preserving encoding for replay.
    const { responseBody, responseBodyBase64, responseEncoding, error } = await (async () => {
      try {
        const buffer = await response.buffer();
        const contentType = headers["content-type"] || "";

        if (isTextResponse(contentType)) {
          return {
            responseBody: buffer.toString("utf-8"),
            responseBodyBase64: undefined,
            responseEncoding: "text" as const,
            error: undefined
          };
        }

        return {
          responseBody: undefined,
          responseBodyBase64: buffer.toString("base64"),
          responseEncoding: "base64" as const,
          error: undefined
        };
      } catch (err: any) {
        return {
          responseBody: undefined,
          responseBodyBase64: undefined,
          responseEncoding: undefined,
          error: String(err)
        };
      }
    })();

    networkRecords.push({
      url,
      method: request.method(),
      requestHeaders,
      requestBody,
      status: response.status(),
      statusText: response.statusText(),
      responseHeaders: headers,
      responseBody,
      responseBodyBase64,
      responseEncoding,
      error,
      timestamp: Date.now()
    });
  });

  // Inject the recording script before any document scripts run.
  await page.evaluateOnNewDocument(preloadScript);

  // Navigate, wait for the page to settle, then capture HTML and recorded requests.
  const snapshot = await (async () => {
    try {
      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded"
      });

      await page.waitForSelector("body", { timeout: 15000 });
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const responseHtml = response ? await response.text() : "";
      const resolvedHtml = responseHtml || (await page.content());
      const $initial = cheerio.load(resolvedHtml);
      const resolvedTitle = $initial("title").first().text() || "snapshot";
      const resolvedFetchXhrRecords = await page.evaluate(() => {
        return (window as any).__websnapRecords || [];
      });

      return {
        title: resolvedTitle,
        html: resolvedHtml,
        fetchXhrRecords: resolvedFetchXhrRecords
      };
    } finally {
      await page.close();
      await browser.close();
    }
  })();

  const { title, html, fetchXhrRecords } = snapshot;

  // Prepare output paths and asset folder names.
  const safeTitle = safeFilename(title || "snapshot");
  const outputHtmlPath = path.resolve(`${safeTitle}.html`);
  const outputRequestsPath = path.resolve(`${safeTitle}.requests.json`);
  const assetsDirName = `${safeTitle}_files`;
  const resourcesDir = path.resolve(assetsDirName);
  await fs.mkdir(resourcesDir, { recursive: true });

  // Map existing network responses to data URLs for CSS rewriting.
  const dataUrlMap = buildDataUrlMap(networkRecords);
  const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, targetUrl);
  const resourceMap = new Map<string, string>();
  const resourceMeta: SnapshotData["resources"] = [];

  // Download external assets to disk and track their local locations.
  for (const resource of resourceUrls) {
    const url = resource.url;
    if (!url || resourceMap.has(url)) {
      continue;
    }

    try {
      const { filename, contentType, size, outputPath } = await downloadResource(url, resourcesDir);
      if ((contentType && contentType.includes("text/css")) || outputPath.endsWith(".css")) {
        await rewriteCssUrls(outputPath, url, dataUrlMap);
      }

      resourceMap.set(url, filename);
      resourceMeta.push({
        url,
        localPath: path.join(assetsDirName, filename),
        contentType,
        size
      });
    } catch {
      continue;
    }
  }

  // Rewrite DOM references to point at local assets.
  applyResourceMapToDom($, resourceUrls, srcsetItems, targetUrl, resourceMap, assetsDirName);

  // Build the snapshot metadata used by the replay script.
  const snapshotData: SnapshotData = {
    url: targetUrl,
    title,
    capturedAt: new Date().toISOString(),
    fetchXhrRecords,
    networkRecords,
    resources: resourceMeta
  };

  // Inject the replay script into the snapshot HTML.
  const replayScript = buildReplayScript(snapshotData, targetUrl);
  const head = $("head");
  if (head.length) {
    head.prepend(replayScript);
  } else {
    $.root().prepend(replayScript);
  }

  // Persist the snapshot HTML and JSON metadata to disk.
  await fs.writeFile(outputRequestsPath, JSON.stringify(snapshotData, null, 2), "utf-8");
  await fs.writeFile(outputHtmlPath, $.html(), "utf-8");

  console.log(`Saved ${outputHtmlPath}`);
  console.log(`Saved ${outputRequestsPath}`);
  console.log(`Saved resources to ${resourcesDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
