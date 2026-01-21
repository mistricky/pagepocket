import type { CheerioAPI } from "cheerio";

import { toDataUrlFromRecord } from "../lib/network-records";
import type { NetworkRecord } from "../lib/types";

type RewriteLinksInput = {
  $: CheerioAPI;
  targetUrl: string;
  assetsDirName: string;
  networkRecords: NetworkRecord[];
};

export const rewriteLinkHrefs = (input: RewriteLinksInput) => {
  const networkRecordByUrl = new Map<string, NetworkRecord>();
  for (const record of input.networkRecords) {
    if (record?.url && !networkRecordByUrl.has(record.url)) {
      networkRecordByUrl.set(record.url, record);
    }
  }

  const linkBase = (() => {
    try {
      const parsed = new URL(input.targetUrl);
      const baseOrigin = parsed.origin;
      const baseDir = new URL(".", parsed).toString().replace(/\/$/, "");
      return { baseOrigin, baseDir };
    } catch {
      return { baseOrigin: "", baseDir: "" };
    }
  })();

  const expandUrlVariants = (value: string) => {
    const variants: string[] = [];
    if (typeof value === "string") {
      variants.push(value);
      try {
        variants.push(new URL(value, input.targetUrl).toString());
      } catch {
        // Ignore invalid URL inputs.
      }
      if (linkBase.baseOrigin && value.startsWith("/")) {
        variants.push(linkBase.baseOrigin + value);
        if (linkBase.baseDir) {
          variants.push(linkBase.baseDir + value);
        }
      } else if (linkBase.baseDir) {
        variants.push(linkBase.baseDir + (value.startsWith("/") ? value : "/" + value));
      }
      try {
        const parsed = new URL(value, input.targetUrl);
        const pathWithSearch = (parsed.pathname || "") + (parsed.search || "");
        if (linkBase.baseOrigin && parsed.origin !== linkBase.baseOrigin) {
          variants.push(linkBase.baseOrigin + pathWithSearch);
          if (linkBase.baseDir) {
            const path = pathWithSearch.startsWith("/") ? pathWithSearch : "/" + pathWithSearch;
            variants.push(linkBase.baseDir + path);
          }
        }
      } catch {
        // Ignore invalid URL inputs.
      }
    }
    return Array.from(new Set(variants.filter(Boolean)));
  };

  const findNetworkRecord = (value: string) => {
    for (const variant of expandUrlVariants(value)) {
      const direct = networkRecordByUrl.get(variant);
      if (direct) {
        return direct;
      }
    }
    for (const variant of expandUrlVariants(value)) {
      try {
        const parsed = new URL(variant);
        const withoutQuery = parsed.origin + parsed.pathname;
        const direct = networkRecordByUrl.get(withoutQuery);
        if (direct) {
          return direct;
        }
      } catch {
        // Ignore invalid URL inputs.
      }
    }
    return null;
  };

  const rewriteModuleImports = (source: string) => {
    const replaceSpecifier = (specifier: string) => {
      const trimmed = specifier.trim();
      if (
        !trimmed ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("blob:") ||
        trimmed.startsWith("mailto:") ||
        trimmed.startsWith("tel:") ||
        trimmed.startsWith("javascript:") ||
        trimmed.startsWith("#")
      ) {
        return specifier;
      }
      const record = findNetworkRecord(trimmed);
      const dataUrl = record ? toDataUrlFromRecord(record) : null;
      return dataUrl ?? specifier;
    };

    const importFromPattern = /(\bimport\s+[^'"]*?\sfrom\s+)(["'])([^"']+)\2/g;
    const importSideEffectPattern = /(\bimport\s+)(["'])([^"']+)\2/g;

    const withFrom = source.replace(importFromPattern, (_match, prefix, quote, specifier) => {
      const next = replaceSpecifier(specifier);
      return `${prefix}${quote}${next}${quote}`;
    });

    return withFrom.replace(importSideEffectPattern, (_match, prefix, quote, specifier) => {
      const next = replaceSpecifier(specifier);
      return `${prefix}${quote}${next}${quote}`;
    });
  };

  input.$("link[href]").each((_, element) => {
    const href = input.$(element).attr("href");
    if (!href) {
      return;
    }
    const trimmed = href.trim();
    if (
      !trimmed ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("#") ||
      trimmed.includes(input.assetsDirName)
    ) {
      return;
    }
    const record = findNetworkRecord(trimmed);
    const dataUrl = record ? toDataUrlFromRecord(record) : null;
    if (dataUrl) {
      input.$(element).attr("href", dataUrl);
    }
  });

  input.$('script[type="module"]').each((_, element) => {
    const src = input.$(element).attr("src");
    if (src) {
      return;
    }
    const original = input.$(element).html();
    if (!original) {
      return;
    }
    const rewritten = rewriteModuleImports(original);
    if (rewritten !== original) {
      input.$(element).html(rewritten);
    }
  });
};
