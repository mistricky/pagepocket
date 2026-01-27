import fs from "node:fs/promises";
import path from "node:path";

import { safeFilename } from "../lib/filename";

type PrepareOutputResult = {
  safeTitle: string;
  outputDir: string;
};

export const prepareOutputDir = async (
  title: string,
  outputFlag?: string
): Promise<PrepareOutputResult> => {
  const safeTitle = safeFilename(title || "snapshot");
  const baseDir = outputFlag ? path.resolve(outputFlag) : process.cwd();
  const outputDir = path.join(baseDir, safeTitle);
  await fs.mkdir(outputDir, { recursive: true });

  return {
    safeTitle,
    outputDir
  };
};
