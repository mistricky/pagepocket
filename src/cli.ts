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
import type { FetchRecord, NetworkRecord, SnapshotData } from "./lib/types";

const usage = () => {
  return "Usage: websnap <url>";
};

const main = async () => {
  const [targetUrl] = process.argv.slice(2);
  if (!targetUrl) {
    console.error(usage());
    process.exit(1);
  }

  const preloadPath = path.join(__dirname, "preload.js");
  const preloadScript = await fs.readFile(preloadPath, "utf-8");

  const browser = await puppeteer.launch({
    headless: true
  });

  const page = await browser.newPage();
  await page.setRequestInterception(true);

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
    let responseBody: string | undefined;
    let responseBodyBase64: string | undefined;
    let responseEncoding: "text" | "base64" | undefined;
    let error: string | undefined;

    try {
      const buffer = await response.buffer();
      const contentType = headers["content-type"] || "";
      if (isTextResponse(contentType)) {
        responseBody = buffer.toString("utf-8");
        responseEncoding = "text";
      } else {
        responseBodyBase64 = buffer.toString("base64");
        responseEncoding = "base64";
      }
    } catch (err: any) {
      error = String(err);
    }

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

  await page.evaluateOnNewDocument(preloadScript);

  let title = "snapshot";
  let html = "";
  let fetchXhrRecords: FetchRecord[] = [];

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForSelector("body", { timeout: 15000 });
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (response) {
      html = await response.text();
    }
    if (!html) {
      html = await page.content();
    }
    const $initial = cheerio.load(html);
    title = $initial("title").first().text() || "snapshot";
    fetchXhrRecords = await page.evaluate(() => {
      return (window as any).__websnapRecords || [];
    });
  } finally {
    await page.close();
    await browser.close();
  }

  const safeTitle = safeFilename(title || "snapshot");
  const outputHtmlPath = path.resolve(`${safeTitle}.html`);
  const outputRequestsPath = path.resolve(`${safeTitle}.requests.json`);
  const assetsDirName = `${safeTitle}_files`;
  const resourcesDir = path.resolve(assetsDirName);
  await fs.mkdir(resourcesDir, { recursive: true });

  const dataUrlMap = buildDataUrlMap(networkRecords);
  const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, targetUrl);
  const resourceMap = new Map<string, string>();
  const resourceMeta: SnapshotData["resources"] = [];

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

  applyResourceMapToDom($, resourceUrls, srcsetItems, targetUrl, resourceMap, assetsDirName);

  const snapshotData: SnapshotData = {
    url: targetUrl,
    title,
    capturedAt: new Date().toISOString(),
    fetchXhrRecords,
    networkRecords,
    resources: resourceMeta
  };

  const replayScript = buildReplayScript(snapshotData, targetUrl);
  const head = $("head");
  if (head.length) {
    head.prepend(replayScript);
  } else {
    $.root().prepend(replayScript);
  }

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
