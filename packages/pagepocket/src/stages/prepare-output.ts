import fs from "node:fs/promises";
import path from "node:path";

import { safeFilename } from "../lib/filename";

type PrepareOutputResult = {
  safeTitle: string;
  baseDir: string;
  outputHtmlPath: string;
  outputRequestsPath: string;
  assetsDirName: string;
  resourcesDir: string;
};

export const prepareOutputPaths = async (
  title: string,
  outputFlag?: string
): Promise<PrepareOutputResult> => {
  const safeTitle = safeFilename(title || "snapshot");
  const baseDir = outputFlag ? path.resolve(outputFlag) : process.cwd();
  const outputHtmlPath = path.join(baseDir, `${safeTitle}.html`);
  const outputRequestsPath = path.join(baseDir, `${safeTitle}.requests.json`);
  const assetsDirName = `${safeTitle}_files`;
  const resourcesDir = path.join(baseDir, assetsDirName);
  await fs.mkdir(resourcesDir, { recursive: true });

  return {
    safeTitle,
    baseDir,
    outputHtmlPath,
    outputRequestsPath,
    assetsDirName,
    resourcesDir
  };
};
