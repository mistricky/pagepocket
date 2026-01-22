import type { CheerioAPI } from "cheerio";

import { rewriteCssUrls } from "./css-rewrite";
import { toDataUrlFromRecord } from "./network-records";
import { toAbsoluteUrl, type ResourceReference, type SrcsetReference } from "./resources";
import type { NetworkRecord } from "./types";
import type { DownloadedResource } from "./download-resources";

type RewriteLinksInput = {
  $: CheerioAPI;
  resourceUrls: ResourceReference[];
  srcsetItems: SrcsetReference[];
  baseUrl: string;
  assetsDirName: string;
  resourceMap: Map<string, DownloadedResource>;
  networkRecords: NetworkRecord[];
};

const shouldSkipValue = (value: string, assetsDirName: string) => {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("#") ||
    trimmed.includes(assetsDirName)
  );
};

const buildLinkBase = (baseUrl: string) => {
  try {
    const parsed = new URL(baseUrl);
    const baseOrigin = parsed.origin;
    const baseDir = new URL(".", parsed).toString().replace(/\/$/, "");
    return { baseOrigin, baseDir };
  } catch {
    return { baseOrigin: "", baseDir: "" };
  }
};

const expandUrlVariants = (value: string, baseUrl: string, baseOrigin: string, baseDir: string) => {
  const variants: string[] = [];
  if (typeof value === "string") {
    variants.push(value);
    try {
      variants.push(new URL(value, baseUrl).toString());
    } catch {
      // ignore
    }
    if (baseOrigin && value.startsWith("/")) {
      variants.push(baseOrigin + value);
      if (baseDir) {
        variants.push(baseDir + value);
      }
    } else if (baseDir) {
      variants.push(baseDir + (value.startsWith("/") ? value : "/" + value));
    }
    try {
      const parsed = new URL(value, baseUrl);
      const pathWithSearch = (parsed.pathname || "") + (parsed.search || "");
      if (baseOrigin && parsed.origin !== baseOrigin) {
        variants.push(baseOrigin + pathWithSearch);
        if (baseDir) {
          const path = pathWithSearch.startsWith("/") ? pathWithSearch : "/" + pathWithSearch;
          variants.push(baseDir + path);
        }
      }
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(variants.filter(Boolean)));
};

const buildNetworkLookup = (records: NetworkRecord[]) => {
  const networkRecordByUrl = new Map<string, NetworkRecord>();
  for (const record of records) {
    if (record?.url && !networkRecordByUrl.has(record.url)) {
      networkRecordByUrl.set(record.url, record);
    }
  }
  return networkRecordByUrl;
};

export const rewriteLinks = async (input: RewriteLinksInput): Promise<void> => {
  const { readAsURL } = await import("@pagepocket/uni-fs");
  const networkRecordByUrl = buildNetworkLookup(input.networkRecords);
  const { baseOrigin, baseDir } = buildLinkBase(input.baseUrl);
  const localUrlCache = new Map<string, string>();

  const resolveLocalUrl = async (value: string) => {
    if (shouldSkipValue(value, input.assetsDirName)) {
      return null;
    }

    const variants = expandUrlVariants(value, input.baseUrl, baseOrigin, baseDir);

    for (const variant of variants) {
      const resource = input.resourceMap.get(variant);
      if (!resource) {
        continue;
      }
      const cacheKey = resource.extension
        ? `${resource.filename}.${resource.extension}`
        : resource.filename;
      if (localUrlCache.has(cacheKey)) {
        return localUrlCache.get(cacheKey) ?? null;
      }
      const localUrl = await readAsURL(
        `${input.assetsDirName}/${resource.filename}`,
        resource.extension
      );
      localUrlCache.set(cacheKey, localUrl);
      return localUrl;
    }

    for (const variant of variants) {
      const record = networkRecordByUrl.get(variant);
      if (record) {
        return toDataUrlFromRecord(record);
      }
    }

    for (const variant of variants) {
      try {
        const parsed = new URL(variant);
        const withoutQuery = parsed.origin + parsed.pathname;
        const record = networkRecordByUrl.get(withoutQuery);
        if (record) {
          return toDataUrlFromRecord(record);
        }
      } catch {
        // ignore
      }
    }

    return null;
  };

  for (const resource of input.resourceUrls) {
    const rawValue = input.$(resource.element).attr(resource.attr);
    if (!rawValue) {
      continue;
    }
    const nextUrl = await resolveLocalUrl(rawValue);
    if (nextUrl) {
      input.$(resource.element).attr(resource.attr, nextUrl);
    }
  }

  for (const item of input.srcsetItems) {
    const parts = item.value.split(",").map((part) => part.trim());
    const rewrittenParts: string[] = [];
    for (const part of parts) {
      const [rawUrl, descriptor] = part.split(/\s+/, 2);
      if (!rawUrl) {
        rewrittenParts.push(part);
        continue;
      }
      const nextUrl = await resolveLocalUrl(rawUrl);
      if (!nextUrl) {
        rewrittenParts.push(part);
        continue;
      }
      rewrittenParts.push(descriptor ? `${nextUrl} ${descriptor}` : nextUrl);
    }
    input.$(item.element).attr("srcset", rewrittenParts.join(", "));
  }

  const rewriteModuleImports = async (source: string) => {
    const replaceSpecifier = async (specifier: string) => {
      const trimmed = specifier.trim();
      if (shouldSkipValue(trimmed, input.assetsDirName)) {
        return specifier;
      }
      const next = await resolveLocalUrl(trimmed);
      return next ?? specifier;
    };

    const importFromPattern = /(\bimport\s+[^'"]*?\sfrom\s+)(["'])([^"']+)\2/g;
    const importSideEffectPattern = /(\bimport\s+)(["'])([^"']+)\2/g;

    let replaced = "";
    let lastIndex = 0;
    for (const match of source.matchAll(importFromPattern)) {
      const index = match.index ?? 0;
      replaced += source.slice(lastIndex, index);
      const prefix = match[1] || "";
      const quote = match[2] || "";
      const specifier = match[3] || "";
      const next = await replaceSpecifier(specifier);
      replaced += `${prefix}${quote}${next}${quote}`;
      lastIndex = index + match[0].length;
    }
    replaced += source.slice(lastIndex);

    let final = "";
    lastIndex = 0;
    for (const match of replaced.matchAll(importSideEffectPattern)) {
      const index = match.index ?? 0;
      final += replaced.slice(lastIndex, index);
      const prefix = match[1] || "";
      const quote = match[2] || "";
      const specifier = match[3] || "";
      const next = await replaceSpecifier(specifier);
      final += `${prefix}${quote}${next}${quote}`;
      lastIndex = index + match[0].length;
    }
    final += replaced.slice(lastIndex);

    return final;
  };

  const rewritePromises: Promise<void>[] = [];
  const moduleScripts = input.$('script[type="module"]').toArray();
  for (const element of moduleScripts) {
    const src = input.$(element).attr("src");
    if (src) {
      continue;
    }
    const original = input.$(element).html();
    if (!original) {
      continue;
    }
    rewritePromises.push(
      rewriteModuleImports(original).then((rewritten) => {
        if (rewritten !== original) {
          input.$(element).html(rewritten);
        }
      })
    );
  }

  for (const resource of input.resourceMap.values()) {
    const isCss =
      (resource.contentType && resource.contentType.includes("text/css")) ||
      resource.extension.toLowerCase() === "css";
    if (!isCss) {
      continue;
    }

    const cssUrl = resource.url;
    rewritePromises.push(
      rewriteCssUrls({
        filename: `${input.assetsDirName}/${resource.filename}`,
        extension: resource.extension,
        cssUrl,
        resolveUrl: async (absoluteUrl) => {
          const direct = input.resourceMap.get(absoluteUrl);
          if (direct) {
            return readAsURL(`${input.assetsDirName}/${direct.filename}`, direct.extension);
          }
          const fallback = toAbsoluteUrl(input.baseUrl, absoluteUrl);
          const record = networkRecordByUrl.get(fallback) || networkRecordByUrl.get(absoluteUrl);
          return record ? toDataUrlFromRecord(record) : null;
        }
      }).then(() => {})
    );
  }

  if (rewritePromises.length) {
    await Promise.all(rewritePromises);
  }
};
