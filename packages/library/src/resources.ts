import * as cheerio from "cheerio";

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
