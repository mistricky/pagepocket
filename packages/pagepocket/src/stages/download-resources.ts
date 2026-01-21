import path from "node:path";

import { buildDataUrlMap, rewriteCssUrls } from "../lib/css-rewrite";
import { applyResourceMapToDom, downloadResource, extractResourceUrls } from "../lib/resources";
import type { NetworkRecord, SnapshotData } from "../lib/types";

type DownloadResourcesResult = {
  $: ReturnType<typeof import("cheerio").load>;
  resourceMeta: SnapshotData["resources"];
  downloadedCount: number;
  failedCount: number;
};

type DownloadResourcesInput = {
  html: string;
  targetUrl: string;
  networkRecords: NetworkRecord[];
  resourcesDir: string;
  assetsDirName: string;
};

export const downloadResources = async (
  input: DownloadResourcesInput
): Promise<DownloadResourcesResult> => {
  const dataUrlMap = buildDataUrlMap(input.networkRecords);
  const { $, resourceUrls, srcsetItems } = extractResourceUrls(input.html, input.targetUrl);
  const resourceMap = new Map<string, string>();
  const resourceMeta: SnapshotData["resources"] = [];
  let downloadedCount = 0;
  let failedCount = 0;

  for (const resource of resourceUrls) {
    const url = resource.url;
    if (!url || resourceMap.has(url)) {
      continue;
    }

    try {
      const { filename, contentType, size, outputPath } = await downloadResource(
        url,
        input.resourcesDir,
        input.targetUrl
      );
      if ((contentType && contentType.includes("text/css")) || outputPath.endsWith(".css")) {
        await rewriteCssUrls(outputPath, url, dataUrlMap);
      }

      resourceMap.set(url, filename);
      resourceMeta.push({
        url,
        localPath: path.join(input.assetsDirName, filename),
        contentType,
        size
      });
      downloadedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  applyResourceMapToDom(
    $,
    resourceUrls,
    srcsetItems,
    input.targetUrl,
    resourceMap,
    input.assetsDirName
  );

  return {
    $,
    resourceMeta,
    downloadedCount,
    failedCount
  };
};
