import { extensionFromContentType } from "./content-type";
import { toAbsoluteUrl, type ResourceReference, type SrcsetReference } from "./resources";
import type { SnapshotData } from "./types";

export type DownloadedResource = {
  url: string;
  filename: string;
  extension: string;
  localPath: string;
  contentType?: string | null;
  size?: number;
};

type DownloadResourcesInput = {
  baseUrl: string;
  assetsDirName: string;
  resourceUrls: ResourceReference[];
  srcsetItems: SrcsetReference[];
  referer?: string;
};

type DownloadResourcesResult = {
  resourceMap: Map<string, DownloadedResource>;
  resourceMeta: SnapshotData["resources"];
  downloadedCount: number;
  failedCount: number;
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const shouldSkipUrl = (value: string) => {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("#")
  );
};

const hashUrl = (value: string) => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const extensionFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1) {
      return "";
    }
    return pathname.slice(lastDot);
  } catch {
    return "";
  }
};

const normalizeExtension = (extension: string) => {
  if (!extension) {
    return "";
  }
  return extension.startsWith(".") ? extension.slice(1) : extension;
};

const buildLocalPath = (assetsDirName: string, filename: string, extension: string) => {
  const normalizedExtension = normalizeExtension(extension);
  if (!normalizedExtension) {
    return `${assetsDirName}/${filename}`;
  }
  return `${assetsDirName}/${filename}.${normalizedExtension}`;
};

const collectSrcsetUrls = (items: SrcsetReference[], baseUrl: string) => {
  const urls: string[] = [];
  for (const item of items) {
    const parts = item.value.split(",").map((part) => part.trim());
    for (const part of parts) {
      const [rawUrl] = part.split(/\s+/, 2);
      if (!rawUrl) {
        continue;
      }
      const absolute = toAbsoluteUrl(baseUrl, rawUrl);
      urls.push(absolute);
    }
  }
  return urls;
};

export const downloadResources = async (
  input: DownloadResourcesInput
): Promise<DownloadResourcesResult> => {
  const { write, exists } = await import("@pagepocket/uni-fs");
  const resourceMap = new Map<string, DownloadedResource>();
  const resourceMeta: SnapshotData["resources"] = [];
  let downloadedCount = 0;
  let failedCount = 0;

  const srcsetUrls = collectSrcsetUrls(input.srcsetItems, input.baseUrl);
  const candidateUrls = [...input.resourceUrls.map((resource) => resource.url), ...srcsetUrls];

  for (const candidate of candidateUrls) {
    if (shouldSkipUrl(candidate)) {
      continue;
    }
    const url = toAbsoluteUrl(input.baseUrl, candidate);
    if (!url || resourceMap.has(url)) {
      continue;
    }

    try {
      const headers: Record<string, string> = {};
      if (input.referer) {
        headers.referer = input.referer;
      }
      const response = await fetch(url, { redirect: "follow", headers });
      const contentType = response.headers.get("content-type");
      const buffer = new Uint8Array(await response.arrayBuffer());
      const extFromUrl = extensionFromUrl(url);
      const extFromType = extensionFromContentType(contentType);
      const extension = normalizeExtension(extFromUrl || extFromType);
      const filename = hashUrl(url);
      const localPath = buildLocalPath(input.assetsDirName, filename, extension);

      if (!(await exists(input.assetsDirName + "/" + filename, extension))) {
        await write(input.assetsDirName + "/" + filename, extension, buffer);
      }

      const entry: DownloadedResource = {
        url,
        filename,
        extension,
        localPath,
        contentType,
        size: buffer.byteLength
      };
      resourceMap.set(url, entry);
      resourceMeta.push({
        url,
        localPath,
        contentType,
        size: buffer.byteLength
      });
      downloadedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    resourceMap,
    resourceMeta,
    downloadedCount,
    failedCount
  };
};
