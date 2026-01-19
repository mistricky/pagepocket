import fs from "node:fs/promises";
import path from "node:path";

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import * as cheerio from "cheerio";
import { Lighterceptor } from "lighterceptor";
import ora from "ora";

import { buildDataUrlMap, rewriteCssUrls } from "./lib/css-rewrite";
import { safeFilename } from "./lib/filename";
import { buildReplayScript } from "./lib/replay-script";
import { applyResourceMapToDom, downloadResource, extractResourceUrls } from "./lib/resources";
import type { LighterceptorNetworkRecord, NetworkRecord, SnapshotData } from "./lib/types";

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

const mapLighterceptorRecords = (
  records: LighterceptorNetworkRecord[] | undefined
): NetworkRecord[] => {
  if (!records) return [];
  return records.map((record) => {
    const response = record.response;
    return {
      url: record.url,
      method: record.method,
      status: response?.status,
      statusText: response?.statusText,
      responseHeaders: response?.headers,
      responseBody: response?.bodyEncoding === "text" ? response.body : undefined,
      responseBodyBase64: response?.bodyEncoding === "base64" ? response.body : undefined,
      responseEncoding: response?.bodyEncoding,
      error: record.error,
      timestamp: record.timestamp
    };
  });
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

    const visitSpinner = ora("Fetching the target HTML").start();
    const fetchTimeoutMs = Number(process.env.PAGEPOCKET_FETCH_TIMEOUT_MS || "60000");
    let html = "";
    let title = "snapshot";
    const fetchXhrRecords: SnapshotData["fetchXhrRecords"] = [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        redirect: "follow"
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      html = await response.text();
      const $initial = cheerio.load(html);
      title = $initial("title").first().text() || "snapshot";
      visitSpinner.succeed("Fetched the target HTML");
    } catch (error) {
      visitSpinner.fail("Failed to fetch the target HTML");
      throw error;
    }

    const networkSpinner = ora("Capturing network requests with lighterceptor").start();
    let networkRecords: NetworkRecord[] = [];
    let lighterceptorNetworkRecords: LighterceptorNetworkRecord[] = [];
    let capturedTitle: string | undefined;
    try {
      const result = await new Lighterceptor(targetUrl, { recursion: true }).run();
      lighterceptorNetworkRecords = (result.networkRecords ?? []) as LighterceptorNetworkRecord[];
      networkRecords = mapLighterceptorRecords(lighterceptorNetworkRecords);
      capturedTitle = result.title;
      if (title === "snapshot" && capturedTitle) {
        title = capturedTitle;
      }
      networkSpinner.succeed(`Captured ${networkRecords.length} network responses`);
    } catch {
      networkSpinner.fail("Failed to capture network requests");
    }

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
      networkRecords: lighterceptorNetworkRecords,
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
    process.exit();
  }
}
