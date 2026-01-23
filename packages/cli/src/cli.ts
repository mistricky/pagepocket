import path from "node:path";

import { Args, Command, Flags } from "@oclif/core";
import { PagePocket, type SnapshotData } from "@pagepocket/lib";
import { LighterceptorAdapter } from "@pagepocket/lighterceptor-adapter";
import chalk from "chalk";

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
    const fetched = await withSpinner(
      async () => fetchHtml(targetUrl, fetchTimeoutMs, headersOverride),
      "Fetching the target HTML"
    );

    const { outputPaths, snapshotData, snapshotHtml } = await withSpinner(async () => {
      const originalCwd = process.cwd();
      const interceptor = new LighterceptorAdapter({ title: fetched.title });
      const snapshotSeed = await interceptor.run(targetUrl);
      const outputPaths = await prepareOutputPaths(snapshotSeed.title, outputFlag);
      const shouldRestoreCwd = outputPaths.baseDir !== originalCwd;

      try {
        if (shouldRestoreCwd) {
          process.chdir(outputPaths.baseDir);
        }

        const pagepocket = new PagePocket(fetched.html, snapshotSeed, {
          baseUrl: targetUrl,
          assetsDirName: outputPaths.assetsDirName,
          requestsPath: path.basename(outputPaths.outputRequestsPath)
        });
        const pageData = await pagepocket.put();

        const snapshotData: SnapshotData = {
          ...snapshotSeed,
          title: pageData.title,
          resources: pagepocket.resources
        };

        return {
          outputPaths,
          snapshotData,
          snapshotHtml: pageData.content
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
