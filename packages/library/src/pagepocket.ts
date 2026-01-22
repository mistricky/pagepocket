import { downloadResources, type DownloadedResource } from "./download-resources";
import { hackHtml } from "./hack-html";
import { mapCapturedNetworkRecords, findFaviconDataUrl } from "./network-records";
import { extractResourceUrls } from "./resources";
import { rewriteLinks } from "./rewrite-links";
import type { CapturedNetworkRecord, NetworkRecord, SnapshotData } from "./types";

export type PagePocketOptions = {
  assetsDirName?: string;
  baseUrl?: string;
  requestsPath?: string;
};

type RequestsInput = SnapshotData | string;

type ParsedRequests = {
  snapshot: SnapshotData;
  networkRecords: NetworkRecord[];
};

const safeFilename = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return "snapshot";
  }
  return (
    trimmed
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "snapshot"
  );
};

const parseRequestsJson = (requestsJSON: RequestsInput): ParsedRequests => {
  const snapshot =
    typeof requestsJSON === "string" ? (JSON.parse(requestsJSON) as SnapshotData) : requestsJSON;

  const rawNetworkRecords = (snapshot.networkRecords || []) as CapturedNetworkRecord[];
  const mappedNetworkRecords = mapCapturedNetworkRecords(rawNetworkRecords);

  return {
    snapshot,
    networkRecords: mappedNetworkRecords
  };
};

export class PagePocket {
  private htmlString: string;
  private requestsJSON: RequestsInput;
  private options: PagePocketOptions;

  resources: SnapshotData["resources"] = [];
  downloadedCount = 0;
  failedCount = 0;

  constructor(htmlString: string, requestsJSON: RequestsInput, options?: PagePocketOptions) {
    this.htmlString = htmlString;
    this.requestsJSON = requestsJSON;
    this.options = options ?? {};
  }

  async put(): Promise<string> {
    const { snapshot, networkRecords } = parseRequestsJson(this.requestsJSON);
    const safeTitle = safeFilename(snapshot.title || "snapshot");
    const assetsDirName = this.options.assetsDirName ?? `${safeTitle}_files`;
    const baseUrl = this.options.baseUrl ?? snapshot.url ?? "";
    const requestsPath = this.options.requestsPath ?? `${safeTitle}.requests.json`;

    const { $, resourceUrls, srcsetItems } = extractResourceUrls(this.htmlString, baseUrl);
    const downloadResult = await downloadResources({
      baseUrl,
      assetsDirName,
      resourceUrls,
      srcsetItems,
      referer: baseUrl
    });

    this.resources = downloadResult.resourceMeta;
    this.downloadedCount = downloadResult.downloadedCount;
    this.failedCount = downloadResult.failedCount;

    await rewriteLinks({
      $,
      resourceUrls,
      srcsetItems,
      baseUrl,
      assetsDirName,
      resourceMap: downloadResult.resourceMap as Map<string, DownloadedResource>,
      networkRecords
    });

    const faviconDataUrl = findFaviconDataUrl(networkRecords);
    hackHtml({
      $,
      baseUrl,
      requestsPath,
      faviconDataUrl
    });

    return $.html();
  }
}
