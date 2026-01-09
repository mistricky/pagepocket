import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { extensionFromContentType } from "./content-type";

type ResourceUrlCandidate = {
  attr: string;
  element: any;
};

export type ResourceReference = {
  attr: string;
  element: any;
  url: string;
};

export type SrcsetReference = {
  element: any;
  value: string;
};

export const toAbsoluteUrl = (baseUrl: string, resourceUrl: string) => {
  try {
    return new URL(resourceUrl, baseUrl).toString();
  } catch {
    return resourceUrl;
  }
};

export const extractResourceUrls = (html: string, baseUrl: string) => {
  const $ = cheerio.load(html);
  const urls: ResourceUrlCandidate[] = [];

  const collect = (selector: string, attr: string) => {
    $(selector).each((_, element) => {
      const value = $(element).attr(attr);
      if (value) {
        urls.push({ attr, element });
      }
    });
  };

  collect("script[src]", "src");
  collect("link[rel=stylesheet][href]", "href");
  collect("link[rel=icon][href]", "href");
  collect("img[src]", "src");
  collect("source[src]", "src");
  collect("video[src]", "src");
  collect("audio[src]", "src");

  const srcsetItems: SrcsetReference[] = [];
  $("img[srcset], source[srcset]").each((_, element) => {
    const value = $(element).attr("srcset");
    if (value) {
      srcsetItems.push({ element, value });
    }
  });

  const resourceUrls: ResourceReference[] = urls.map(({ attr, element }) => {
    const value = $(element).attr(attr) || "";
    return {
      attr,
      element,
      url: toAbsoluteUrl(baseUrl, value)
    };
  });

  return { $, resourceUrls, srcsetItems };
};

export const downloadResource = async (url: string, outputDir: string) => {
  const response = await fetch(url, { redirect: "follow" });
  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath) || extensionFromContentType(contentType);
  const filename = `${crypto.createHash("sha1").update(url).digest("hex")}${ext}`;
  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, buffer);
  return { outputPath, filename, contentType, size: buffer.length };
};

export const applyResourceMapToDom = (
  $: cheerio.CheerioAPI,
  resourceUrls: ResourceReference[],
  srcsetItems: SrcsetReference[],
  baseUrl: string,
  resourceMap: Map<string, string>,
  assetsDirName: string
) => {
  for (const resource of resourceUrls) {
    const local = resourceMap.get(resource.url);
    if (!local) {
      continue;
    }
    $(resource.element).attr(resource.attr, path.join(assetsDirName, local));
  }

  for (const item of srcsetItems) {
    const parts = item.value.split(",").map((part) => part.trim());
    const rewritten = parts
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        const absolute = toAbsoluteUrl(baseUrl, url);
        const local = resourceMap.get(absolute);
        if (!local) {
          return part;
        }
        const nextUrl = path.join(assetsDirName, local);
        return descriptor ? `${nextUrl} ${descriptor}` : nextUrl;
      })
      .join(", ");
    $(item.element).attr("srcset", rewritten);
  }
};
