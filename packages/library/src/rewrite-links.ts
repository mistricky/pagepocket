import * as cheerio from "cheerio";

import { rewriteCssText } from "./css-rewrite";
import { hackHtml } from "./hack-html";

type UrlResolver = (absoluteUrl: string) => string | null;

const shouldSkipValue = (value: string) => {
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

const resolveUrlValue = (value: string, baseUrl: string, resolve: UrlResolver) => {
  if (shouldSkipValue(value)) {
    return null;
  }
  try {
    const absolute = new URL(value, baseUrl).toString();
    return resolve(absolute);
  } catch {
    return null;
  }
};

const rewriteSrcsetValue = (value: string, baseUrl: string, resolve: UrlResolver) => {
  const parts = value.split(",").map((part) => part.trim());
  const rewritten = parts.map((part) => {
    const [rawUrl, descriptor] = part.split(/\s+/, 2);
    if (!rawUrl) return part;
    const resolved = resolveUrlValue(rawUrl, baseUrl, resolve);
    if (!resolved) return part;
    return descriptor ? `${resolved} ${descriptor}` : resolved;
  });
  return rewritten.join(", ");
};

const rewriteMetaRefresh = (content: string, baseUrl: string, resolve: UrlResolver) => {
  const parts = content.split(";");
  if (parts.length < 2) return content;
  const urlPartIndex = parts.findIndex((part) => part.trim().toLowerCase().startsWith("url="));
  if (urlPartIndex === -1) return content;
  const urlPart = parts[urlPartIndex];
  const rawUrl = urlPart.split("=").slice(1).join("=").trim();
  const resolved = resolveUrlValue(rawUrl, baseUrl, resolve);
  if (!resolved) return content;
  const next = `url=${resolved}`;
  const nextParts = parts.slice();
  nextParts[urlPartIndex] = next;
  return nextParts.join(";");
};

export const rewriteJsText = async (source: string, resolve: UrlResolver, baseUrl: string) => {
  const replaceSpecifier = async (specifier: string) => {
    const trimmed = specifier.trim();
    if (shouldSkipValue(trimmed)) {
      return specifier;
    }
    const resolved = resolveUrlValue(trimmed, baseUrl, resolve);
    return resolved ?? specifier;
  };

  const importFromPattern = /(\bimport\s+[^'"]*?\sfrom\s+)(["'])([^"']+)\2/g;
  const importSideEffectPattern = /(\bimport\s+)(["'])([^"']+)\2/g;
  const dynamicImportPattern = /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g;

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

  let dynamicFinal = "";
  lastIndex = 0;
  for (const match of final.matchAll(dynamicImportPattern)) {
    const index = match.index ?? 0;
    dynamicFinal += final.slice(lastIndex, index);
    const prefix = match[1] || "";
    const quote = match[2] || "";
    const specifier = match[3] || "";
    const suffix = match[4] || "";
    const next = await replaceSpecifier(specifier);
    dynamicFinal += `${prefix}${quote}${next}${quote}${suffix}`;
    lastIndex = index + match[0].length;
  }
  dynamicFinal += final.slice(lastIndex);

  return dynamicFinal;
};

export const rewriteEntryHtml = async (input: {
  html: string;
  entryUrl: string;
  apiPath: string;
  resolve: UrlResolver;
  rewriteLinks?: boolean;
}): Promise<{ html: string; title?: string }> => {
  const $ = cheerio.load(input.html);
  const baseUrl = input.entryUrl;
  const resolve = input.resolve;
  const shouldRewriteLinks = input.rewriteLinks !== false;

  const rewriteAttr = (selector: string, attr: string) => {
    $(selector).each((_, element) => {
      const value = $(element).attr(attr);
      if (!value) return;
      const resolved = resolveUrlValue(value, baseUrl, resolve);
      if (resolved) {
        $(element).attr(attr, resolved);
      }
    });
  };

  const rewriteDataAttrs = (selector: string, attr: string) => rewriteAttr(selector, attr);

  if (shouldRewriteLinks) {
    rewriteAttr("script[src]", "src");
    rewriteAttr("img[src]", "src");
    rewriteAttr("source[src]", "src");
    rewriteAttr("video[src]", "src");
    rewriteAttr("audio[src]", "src");
    rewriteAttr("track[src]", "src");
    rewriteAttr("iframe[src]", "src");
    rewriteAttr("embed[src]", "src");
    rewriteAttr("object[data]", "data");
    rewriteAttr("link[href]", "href");
    rewriteAttr("[poster]", "poster");

    rewriteDataAttrs("[data-src]", "data-src");
    rewriteDataAttrs("[data-href]", "data-href");
    rewriteDataAttrs("[data-poster]", "data-poster");
    rewriteDataAttrs("[data-url]", "data-url");

    $("img[srcset], source[srcset]").each((_, element) => {
      const value = $(element).attr("srcset");
      if (!value) return;
      const rewritten = rewriteSrcsetValue(value, baseUrl, resolve);
      $(element).attr("srcset", rewritten);
    });

    $("meta[http-equiv]").each((_, element) => {
      const httpEquiv = ($(element).attr("http-equiv") || "").toLowerCase();
      if (httpEquiv !== "refresh") return;
      const content = $(element).attr("content");
      if (!content) return;
      const rewritten = rewriteMetaRefresh(content, baseUrl, resolve);
      $(element).attr("content", rewritten);
    });
  }

  if (shouldRewriteLinks) {
    const inlineStyles = $("style").toArray();
    for (const element of inlineStyles) {
      const cssText = $(element).html();
      if (!cssText) continue;
      const rewritten = await rewriteCssText({
        cssText,
        cssUrl: baseUrl,
        resolveUrl: resolve
      });
      if (rewritten !== cssText) {
        $(element).html(rewritten);
      }
    }

    const inlineStyleElements = $("[style]").toArray();
    for (const element of inlineStyleElements) {
      const styleText = $(element).attr("style");
      if (!styleText) continue;
      const rewritten = await rewriteCssText({
        cssText: styleText,
        cssUrl: baseUrl,
        resolveUrl: resolve
      });
      if (rewritten !== styleText) {
        $(element).attr("style", rewritten);
      }
    }
  }

  if (shouldRewriteLinks) {
    const moduleScripts = $('script[type="module"]').toArray();
    for (const element of moduleScripts) {
      const src = $(element).attr("src");
      if (src) continue;
      const original = $(element).html();
      if (!original) continue;
      const rewritten = await rewriteJsText(original, resolve, baseUrl);
      if (rewritten !== original) {
        $(element).html(rewritten);
      }
    }
  }

  hackHtml({
    $,
    baseUrl: baseUrl,
    apiPath: input.apiPath
  });

  const title = $("title").first().text() || undefined;

  return { html: $.html(), title };
};
