import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";

import { findFaviconDataUrl } from "./lib/network-records";
import type { LighterceptorNetworkRecord, NetworkRecord, SnapshotData } from "./lib/types";
import { buildSnapshotHtml } from "./stages/build-snapshot";
import { buildSnapshotData } from "./stages/build-snapshot-data";
import { captureNetwork } from "./stages/capture-network";
import { downloadResources } from "./stages/download-resources";
import { fetchHtml } from "./stages/fetch-html";
import { prepareOutputPaths } from "./stages/prepare-output";
import { rewriteLinkHrefs } from "./stages/rewrite-links";
import { writeSnapshotFiles } from "./stages/write-snapshot";

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
    const headersOverride = (() => {
      const raw = process.env.PAGEPOCKET_FETCH_HEADERS;
      if (!raw) {
        return undefined;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (value === undefined || value === null) {
            continue;
          }
          headers[key] = String(value);
        }
        return headers;
      } catch {
        throw new Error("Invalid PAGEPOCKET_FETCH_HEADERS JSON.");
      }
    })();
    let html = "";
    let title = "snapshot";
    const fetchXhrRecords: SnapshotData["fetchXhrRecords"] = [];

    try {
      const result = await fetchHtml(targetUrl, fetchTimeoutMs, headersOverride);
      html = result.html;
      title = result.title;
      visitSpinner.succeed("Fetched the target HTML");
    } catch (error) {
      visitSpinner.fail("Failed to fetch the target HTML");
      throw error;
    }

    const networkSpinner = ora("Capturing network requests with lighterceptor").start();
    let networkRecords: NetworkRecord[] = [];
    let lighterceptorNetworkRecords: LighterceptorNetworkRecord[] = [];
    try {
      const result = await captureNetwork(targetUrl, title);
      lighterceptorNetworkRecords = result.lighterceptorNetworkRecords;
      networkRecords = result.networkRecords;
      title = result.title;
      networkSpinner.succeed(`Captured ${networkRecords.length} network responses`);
    } catch {
      networkSpinner.fail("Failed to capture network requests");
    }

    const faviconDataUrl = findFaviconDataUrl(networkRecords);

    const outputSpinner = ora("Preparing output paths").start();
    let outputPaths: Awaited<ReturnType<typeof prepareOutputPaths>>;
    try {
      outputPaths = await prepareOutputPaths(title, outputFlag);
      outputSpinner.succeed("Prepared output paths");
    } catch (error) {
      outputSpinner.fail("Failed to prepare output paths");
      throw error;
    }

    const downloadSpinner = ora("Downloading resources").start();
    let $: ReturnType<typeof import("cheerio").load>;
    let resourceMeta: SnapshotData["resources"] = [];
    let downloadedCount = 0;
    let failedCount = 0;
    try {
      const result = await downloadResources({
        html,
        targetUrl,
        networkRecords,
        resourcesDir: outputPaths.resourcesDir,
        assetsDirName: outputPaths.assetsDirName
      });
      $ = result.$;
      resourceMeta = result.resourceMeta;
      downloadedCount = result.downloadedCount;
      failedCount = result.failedCount;
      const downloadSummary =
        failedCount > 0
          ? `Resources downloaded (${downloadedCount} saved, ${failedCount} failed)`
          : `Resources downloaded (${downloadedCount} saved)`;
      downloadSpinner.succeed(downloadSummary);
    } catch (error) {
      downloadSpinner.fail("Failed to download resources");
      throw error;
    }

    const rewriteSpinner = ora("Rewriting HTML links").start();
    try {
      rewriteLinkHrefs({
        $,
        targetUrl,
        assetsDirName: outputPaths.assetsDirName,
        networkRecords
      });
      rewriteSpinner.succeed("Rewrote HTML links");
    } catch (error) {
      rewriteSpinner.fail("Failed to rewrite HTML links");
      throw error;
    }

    const prepareSpinner = ora("Preparing snapshot HTML").start();
    let snapshotData: SnapshotData | null = null;
    let snapshotHtml = "";
    try {
      snapshotData = buildSnapshotData({
        targetUrl,
        title,
        fetchXhrRecords,
        lighterceptorNetworkRecords,
        resources: resourceMeta
      });

      snapshotHtml = buildSnapshotHtml({
        $,
        targetUrl,
        outputRequestsPath: outputPaths.outputRequestsPath,
        faviconDataUrl
      });
      prepareSpinner.succeed("Prepared snapshot HTML");
    } catch (error) {
      prepareSpinner.fail("Failed to prepare snapshot HTML");
      throw error;
    }
    if (!snapshotData) {
      throw new Error("Snapshot data was not created.");
    }

    const writeSpinner = ora("Writing snapshot files").start();
    try {
      await writeSnapshotFiles({
        outputRequestsPath: outputPaths.outputRequestsPath,
        outputHtmlPath: outputPaths.outputHtmlPath,
        snapshotData,
        snapshotHtml
      });
      writeSpinner.succeed("Snapshot files written");
    } catch (error) {
      writeSpinner.fail("Failed to write snapshot files");
      throw error;
    }

    this.log(chalk.green("All done! Snapshot created."));
    this.log(`HTML saved to ${chalk.cyan(outputPaths.outputHtmlPath)}`);
    this.log(`Requests saved to ${chalk.cyan(outputPaths.outputRequestsPath)}`);
    this.log(`Resources saved to ${chalk.cyan(outputPaths.resourcesDir)}`);
    process.exit();
  }
}
