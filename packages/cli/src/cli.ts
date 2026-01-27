import { Args, Command, Flags } from "@oclif/core";
import { PagePocket } from "@pagepocket/lib";
import { LighterceptorAdapter } from "@pagepocket/lighterceptor-adapter";
import chalk from "chalk";

import { prepareOutputDir } from "./stages/prepare-output";
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

    const headers: Record<string, string> = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: targetUrl
    };

    const snapshot = await withSpinner(async () => {
      const interceptor = new LighterceptorAdapter({ headers });
      const pagepocket = PagePocket.fromURL(targetUrl);
      return pagepocket.capture({
        interceptor,
        completion: { wait: async () => {} }
      });
    }, "Capturing snapshot");

    const { outputDir } = await withSpinner(
      () => prepareOutputDir(snapshot.title ?? "snapshot", outputFlag),
      "Preparing output directory"
    );

    await withSpinner(async () => {
      await writeSnapshotFiles({
        outputDir,
        snapshot
      });
    }, "Writing snapshot files");

    this.log(chalk.green("All done! Snapshot created."));
    this.log(`Snapshot saved to ${chalk.cyan(outputDir)}`);
    process.exit();
  }
}
