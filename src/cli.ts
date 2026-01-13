import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";
import puppeteer from "puppeteer";
import { buildDataUrlMap, rewriteCssUrls } from "./lib/css-rewrite";
import { safeFilename } from "./lib/filename";
import { applyCaptureHackers } from "./lib/hackers";
import { buildReplayScript } from "./lib/replay-script";
import { applyResourceMapToDom, downloadResource, extractResourceUrls } from "./lib/resources";
import type { NetworkRecord, SnapshotData } from "./lib/types";
import { buildPreloadScript } from "./preload";

const getHeaderValue = (headers: Record<string, string>, name: string) => {
  for (const key in headers) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
};

const toDataUrlFromRecord = (record: NetworkRecord) => {
  if (!record) return null;
  const headers = record.responseHeaders || {};
  const contentType = getHeaderValue(headers, "content-type") || "application/octet-stream";

  if (record.responseEncoding === "base64" && record.responseBodyBase64) {
    return `data:${contentType};base64,${record.responseBodyBase64}`;
  }

  if (record.responseBody) {
    return `data:${contentType};base64,${Buffer.from(record.responseBody, "utf-8").toString("base64")}`;
  }

  return null;
};

const findFaviconDataUrl = (records: NetworkRecord[]) => {
  for (const record of records) {
    if (!record || !record.url) continue;
    const headers = record.responseHeaders || {};
    const contentType = (getHeaderValue(headers, "content-type") || "").toLowerCase();
    const pathname = (() => {
      try {
        return new URL(record.url).pathname;
      } catch {
        return record.url;
      }
    })();

    const looksLikeFavicon =
      contentType.includes("icon") || /favicon(\.[a-z0-9]+)?$/i.test(pathname || "");
    if (!looksLikeFavicon) continue;

    const dataUrl = toDataUrlFromRecord(record);
    if (dataUrl) return dataUrl;
  }
  return null;
};

export default class PagepocketCommand extends Command {
  static description = "Save a snapshot of a web page.";

  static args = {
    url: Args.string({
      description: "URL to snapshot",
      required: true
    })
  };

  static flags = {
    help: Flags.help({
      char: "h"
    }),
    output: Flags.string({
      char: "o",
      description: "Output path for the snapshot HTML file"
    })
  };

  async run() {
    const { args, flags } = await this.parse(PagepocketCommand);
    const targetUrl = args.url;
    const outputFlag = flags.output ? flags.output.trim() : undefined;

    // Build the preload script so it can record fetch/XHR data in the page context.
    const preloadScript = buildPreloadScript();

    // Launch a headless browser to capture both DOM and network activity.
    const browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    const navigationTimeoutMs = Number(process.env.PAGEPOCKET_NAV_TIMEOUT_MS || "60000");
    const pendingTimeoutMs = Number(process.env.PAGEPOCKET_PENDING_TIMEOUT_MS || "40000");
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    // Accumulate network traffic so the replay script can serve responses offline.
    const networkRecords: NetworkRecord[] = [];
    await applyCaptureHackers({ stage: "capture", page, networkRecords });

    // Inject the recording script before any document scripts run.
    await page.evaluateOnNewDocument(preloadScript);

    const visitSpinner = ora("Visiting the target site").start();

    // Navigate, wait for the page to settle, then capture HTML and recorded requests.
    const snapshot = await (async () => {
      try {
        const response = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs
        });

        await page.waitForSelector("body", { timeout: 15000 });
        await page.waitForNetworkIdle({ idleTime: 5000, timeout: 30000 }).catch(() => undefined);
        await page
          .waitForFunction(() => (window as any).__pagepocketPendingRequests === 0, {
            timeout: pendingTimeoutMs
          })
          .catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const hoverSpinner = ora("Hovering elements to trigger hover requests").start();
        try {
          await page.evaluate(() => {
            const events = ["mouseover", "mouseenter", "mousemove"];
            const elements = Array.from(document.querySelectorAll("*"));
            for (const el of elements) {
              try {
                const rect = el.getBoundingClientRect();
                const hasSize = rect && rect.width >= 1 && rect.height >= 1;
                const clientX = hasSize ? rect.left + rect.width / 2 : 0;
                const clientY = hasSize ? rect.top + rect.height / 2 : 0;
                for (const type of events) {
                  const evt = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX,
                    clientY
                  });
                  el.dispatchEvent(evt);
                }
              } catch {}
            }
          });
          hoverSpinner.succeed("Hovered elements to trigger hover requests");
        } catch (hoverError) {
          hoverSpinner.fail("Failed to hover elements");
          throw hoverError;
        }

        await page.waitForNetworkIdle({ idleTime: 5000, timeout: 30000 }).catch(() => undefined);
        await page
          .waitForFunction(() => (window as any).__pagepocketPendingRequests === 0, {
            timeout: pendingTimeoutMs
          })
          .catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        visitSpinner.succeed("Visited the target site");

        const responseHtml = response ? await response.text() : "";
        const resolvedHtml = responseHtml || (await page.content());
        const $initial = cheerio.load(resolvedHtml);
        const resolvedTitle = $initial("title").first().text() || "snapshot";
        const resolvedFetchXhrRecords = await page.evaluate(() => {
          return (window as any).__pagepocketRecords || [];
        });

        return {
          title: resolvedTitle,
          html: resolvedHtml,
          fetchXhrRecords: resolvedFetchXhrRecords
        };
      } catch (error) {
        visitSpinner.fail("Failed to visit the target site");
        throw error;
      } finally {
        await page.close();
        await browser.close();
      }
    })();

    const { title, html, fetchXhrRecords } = snapshot;

    const faviconDataUrl = findFaviconDataUrl(networkRecords);

    // Prepare output paths and asset folder names.
    const safeTitle = safeFilename(title || "snapshot");
    const baseDir = outputFlag ? path.resolve(outputFlag) : process.cwd();
    const outputHtmlPath = path.join(baseDir, `${safeTitle}.html`);
    const outputRequestsPath = path.join(baseDir, `${safeTitle}.requests.json`);
    const assetsDirName = `${safeTitle}_files`;
    const resourcesDir = path.join(baseDir, assetsDirName);
    await fs.mkdir(resourcesDir, { recursive: true });

    // Map existing network responses to data URLs for CSS rewriting.
    const dataUrlMap = buildDataUrlMap(networkRecords);
    const { $, resourceUrls, srcsetItems } = extractResourceUrls(html, targetUrl);
    const resourceMap = new Map<string, string>();
    const resourceMeta: SnapshotData["resources"] = [];
    const downloadSpinner = ora("Downloading resources").start();
    let downloadedCount = 0;
    let failedCount = 0;

    // Download external assets to disk and track their local locations.
    for (const resource of resourceUrls) {
      const url = resource.url;
      if (!url || resourceMap.has(url)) {
        continue;
      }

      try {
        const resourceLabel = (() => {
          try {
            const pathname = new URL(url).pathname;
            const basename = path.basename(pathname);
            return basename || url;
          } catch {
            return url;
          }
        })();
        downloadSpinner.text = `Downloading ${resourceLabel}`;
        const { filename, contentType, size, outputPath } = await downloadResource(
          url,
          resourcesDir,
          targetUrl
        );
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
        downloadedCount += 1;
      } catch {
        failedCount += 1;
        continue;
      }
    }
    const downloadSummary =
      failedCount > 0
        ? `Resources downloaded (${downloadedCount} saved, ${failedCount} failed)`
        : `Resources downloaded (${downloadedCount} saved)`;
    downloadSpinner.succeed(downloadSummary);

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
    const replayScript = buildReplayScript(path.basename(outputRequestsPath), targetUrl);
    const head = $("head");
    if (head.length) {
      head.prepend(replayScript);
    } else {
      $.root().prepend(replayScript);
    }

    if (faviconDataUrl) {
      const existingIcon = $('link[rel="icon"]');
      if (existingIcon.length) {
        existingIcon.attr("href", faviconDataUrl);
      } else {
        const link = '<link rel="icon" href="' + faviconDataUrl + '" />';
        head.length ? head.append(link) : $.root().append(link);
      }
    }

    // Persist the snapshot HTML and JSON metadata to disk.
    await fs.writeFile(outputRequestsPath, JSON.stringify(snapshotData, null, 2), "utf-8");
    await fs.writeFile(outputHtmlPath, $.html(), "utf-8");

    this.log(chalk.green("All done! Snapshot created."));
    this.log(`HTML saved to ${chalk.cyan(outputHtmlPath)}`);
    this.log(`Requests saved to ${chalk.cyan(outputRequestsPath)}`);
    this.log(`Resources saved to ${chalk.cyan(resourcesDir)}`);
  }
}
