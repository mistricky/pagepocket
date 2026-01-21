import fs from "node:fs/promises";

import type { SnapshotData } from "../lib/types";

type WriteSnapshotInput = {
  outputRequestsPath: string;
  outputHtmlPath: string;
  snapshotData: SnapshotData;
  snapshotHtml: string;
};

export const writeSnapshotFiles = async (input: WriteSnapshotInput) => {
  await fs.writeFile(
    input.outputRequestsPath,
    JSON.stringify(input.snapshotData, null, 2),
    "utf-8"
  );
  await fs.writeFile(input.outputHtmlPath, input.snapshotHtml, "utf-8");
};
