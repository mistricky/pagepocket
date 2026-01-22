import * as cheerio from "cheerio";
import got from "got";

type FetchHtmlResult = {
  html: string;
  title: string;
};

export const fetchHtml = async (
  targetUrl: string,
  timeoutMs: number,
  headersOverride?: Record<string, string>
): Promise<FetchHtmlResult> => {
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    referer: targetUrl,
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    ...headersOverride
  };
  const response = await got(targetUrl, {
    headers,
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: timeoutMs }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const statusText = response.statusMessage ? ` ${response.statusMessage}` : "";
    throw new Error(`HTTP ${response.statusCode}${statusText}`);
  }

  const html = response.body;
  const $initial = cheerio.load(html);
  const title = $initial("title").first().text() || "snapshot";
  return { html, title };
};
