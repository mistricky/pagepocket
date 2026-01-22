import path from "node:path";

import { Args, Command, Flags } from "@oclif/core";
import { PagePocket, type SnapshotData } from "@pagepocket/lib";
import chalk from "chalk";

import { buildSnapshotData } from "./stages/build-snapshot-data";
import { captureNetwork } from "./stages/capture-network";
import { fetchHtml } from "./stages/fetch-html";
import { prepareOutputPaths } from "./stages/prepare-output";
import { writeSnapshotFiles } from "./stages/write-snapshot";
import { withSpinner } from "./utils/with-spinner";

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
    const fetchXhrRecords: SnapshotData["fetchXhrRecords"] = [];

    const fetched = await withSpinner(
      async () => fetchHtml(targetUrl, fetchTimeoutMs, headersOverride),
      "Fetching the target HTML"
    );

    const networkStage = await (async () => {
      try {
        return withSpinner(
          () => captureNetwork(targetUrl, fetched.title),
          "Capturing network requests with lighterceptor"
        );
      } catch {
        return {
          networkRecords: [],
          capturedNetworkRecords: [],
          capturedTitle: undefined,
          title: fetched.title
        };
      }
    })();

    const { outputPaths, resourceMeta, snapshotHtml } = await withSpinner(async () => {
      const originalCwd = process.cwd();
      const outputPaths = await prepareOutputPaths(networkStage.title, outputFlag);
      const shouldRestoreCwd = outputPaths.baseDir !== originalCwd;

      try {
        if (shouldRestoreCwd) {
          process.chdir(outputPaths.baseDir);
        }

        const seedSnapshot: SnapshotData = {
          url: targetUrl,
          title: networkStage.title,
          capturedAt: new Date().toISOString(),
          fetchXhrRecords,
          networkRecords: networkStage.capturedNetworkRecords,
          resources: []
        };
        const pagepocket = new PagePocket(fetched.html, seedSnapshot, {
          assetsDirName: outputPaths.assetsDirName,
          baseUrl: targetUrl,
          requestsPath: path.basename(outputPaths.outputRequestsPath)
        });
        const snapshotHtml = await pagepocket.put();

        return {
          snapshotHtml,
          resourceMeta: pagepocket.resources,
          downloadedCount: pagepocket.downloadedCount,
          failedCount: pagepocket.failedCount,
          outputPaths
        };
      } finally {
        if (shouldRestoreCwd) {
          try {
            process.chdir(originalCwd);
          } catch {
            // Ignore restore errors to preserve original failure.
          }
        }
      }
    }, "Downloading resources");

    const snapshotData = await withSpinner(
      async () =>
        buildSnapshotData({
          targetUrl,
          title: networkStage.title,
          fetchXhrRecords,
          capturedNetworkRecords: networkStage.capturedNetworkRecords,
          resources: resourceMeta
        }),
      "Preparing snapshot HTML"
    );

    await withSpinner(async () => {
      await writeSnapshotFiles({
        outputRequestsPath: outputPaths.outputRequestsPath,
        outputHtmlPath: outputPaths.outputHtmlPath,
        snapshotData,
        snapshotHtml: snapshotHtml
      });
    }, "Writing snapshot files");

    this.log(chalk.green("All done! Snapshot created."));
    this.log(`HTML saved to ${chalk.cyan(outputPaths.outputHtmlPath)}`);
    this.log(`Requests saved to ${chalk.cyan(outputPaths.outputRequestsPath)}`);
    this.log(`Resources saved to ${chalk.cyan(outputPaths.resourcesDir)}`);
    process.exit();
  }
}
