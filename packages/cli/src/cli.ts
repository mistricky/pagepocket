import path from "node:path";

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";

import { PagePocket } from "@pagepocket/lib";
import type { LighterceptorNetworkRecord, NetworkRecord, SnapshotData } from "@pagepocket/lib";
import { buildSnapshotData } from "./stages/build-snapshot-data";
import { captureNetwork } from "./stages/capture-network";
import { fetchHtml } from "./stages/fetch-html";
import { prepareOutputPaths } from "./stages/prepare-output";
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
    let resourceMeta: SnapshotData["resources"] = [];
    let downloadedCount = 0;
    let failedCount = 0;
    let snapshotHtml = "";
    const originalCwd = process.cwd();
    const shouldRestoreCwd = outputPaths.baseDir !== originalCwd;
    try {
      if (shouldRestoreCwd) {
        process.chdir(outputPaths.baseDir);
      }
      const seedSnapshot: SnapshotData = {
        url: targetUrl,
        title,
        capturedAt: new Date().toISOString(),
        fetchXhrRecords,
        networkRecords: lighterceptorNetworkRecords,
        resources: []
      };
      const pagepocket = new PagePocket(html, seedSnapshot, {
        assetsDirName: outputPaths.assetsDirName,
        baseUrl: targetUrl,
        requestsPath: path.basename(outputPaths.outputRequestsPath)
      });
      snapshotHtml = await pagepocket.put();
      resourceMeta = pagepocket.resources;
      downloadedCount = pagepocket.downloadedCount;
      failedCount = pagepocket.failedCount;

      const downloadSummary =
        failedCount > 0
          ? `Resources downloaded (${downloadedCount} saved, ${failedCount} failed)`
          : `Resources downloaded (${downloadedCount} saved)`;
      downloadSpinner.succeed(downloadSummary);
    } catch (error) {
      downloadSpinner.fail("Failed to download resources");
      throw error;
    } finally {
      if (shouldRestoreCwd) {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore restore errors to preserve original failure.
        }
      }
    }

    const prepareSpinner = ora("Preparing snapshot HTML").start();
    let snapshotData: SnapshotData | null = null;
    try {
      snapshotData = buildSnapshotData({
        targetUrl,
        title,
        fetchXhrRecords,
        lighterceptorNetworkRecords,
        resources: resourceMeta
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
