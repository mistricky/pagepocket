import {
  analyzeJs as analyzeJsDependencies,
  recordCssUrls as recordCssUrlsDependencies
} from "./dependency-analysis.js";
import { analyzeHtml } from "./html-analysis.js";
import type {
  LighterceptorOptions,
  LighterceptorResult,
  NetworkRecord,
  RequestRecord,
  ResourceKind
} from "./lighterceptor-model.js";
import { createFetchWithCache, type FetchResult } from "./network-utils.js";
import {
  detectInputKind,
  detectResourceKind,
  isSkippableUrl,
  parseAbsoluteUrl,
  resolveUrl
} from "./resource-utils.js";
import type { RequestSource } from "./types.js";

export type {
  LighterceptorOptions,
  LighterceptorResult,
  NetworkRecord,
  RequestRecord,
  ResourceKind,
  ResponseRecord
} from "./lighterceptor-model.js";

const DEFAULT_SETTLE_MS = 50;

type ResourceContent = {
  text: string;
  contentType?: string;
  buffer?: Buffer;
};

export class Lighterceptor {
  private input: string;
  private options: LighterceptorOptions;

  constructor(input: string, options: LighterceptorOptions = {}) {
    this.input = input;
    this.options = options;
  }

  async run(): Promise<LighterceptorResult> {
    const requests: RequestRecord[] = [];
    const networkRecords: NetworkRecord[] = [];
    const capturedAt = new Date().toISOString();
    const settleTimeMs = this.options.settleTimeMs ?? DEFAULT_SETTLE_MS;
    const recursive = this.options.recursion ?? false;
    const requestOnly = this.options.requestOnly ?? false;
    const baseUrl = this.options.baseUrl;
    const pending: Array<{ url: string; kind?: ResourceKind }> = [];
    const processed = new Set<string>();
    const resourceCache = new Map<string, Promise<ResourceContent | null>>();
    const responseCache = new Map<string, Promise<FetchResult>>();
    const pendingNetwork: Array<Promise<void>> = [];

    const fetchWithCache = createFetchWithCache(responseCache);

    const recordNetwork = (url: string, source: RequestSource | "unknown") => {
      if (requestOnly || isSkippableUrl(url)) {
        return;
      }
      const task = fetchWithCache(url).then((result) => {
        const record: NetworkRecord = {
          url,
          source,
          method: "GET",
          timestamp: Date.now()
        };
        if (result.response) {
          record.response = result.response;
        }
        if (!result.ok) {
          record.error = result.error ?? "request-failed";
        }
        networkRecords.push(record);
      });
      pendingNetwork.push(task);
    };

    const recordUrl = (url: string, source: RequestSource | "unknown", baseUrl?: string) => {
      const resolved = resolveUrl(baseUrl, url);
      if (!resolved) {
        return;
      }

      requests.push({
        url: resolved,
        source,
        timestamp: Date.now()
      });

      recordNetwork(resolved, source);
    };

    const enqueue = (url: string, kind?: ResourceKind) => {
      if (!recursive || isSkippableUrl(url)) {
        return;
      }
      if (processed.has(url)) {
        return;
      }
      processed.add(url);
      pending.push({ url, kind });
    };

    const recordCssUrls = (cssText: string, cssBaseUrl?: string) =>
      recordCssUrlsDependencies(cssText, cssBaseUrl, recordUrl, enqueue);

    const analyzeJs = (jsText: string, jsBaseUrl?: string) =>
      analyzeJsDependencies(jsText, jsBaseUrl, recordUrl, enqueue);

    const loadResource = async (url: string) => {
      const existing = resourceCache.get(url);
      if (existing) {
        return existing;
      }
      const loader = fetchWithCache(url).then((result) => {
        if (!result.ok || !result.text) {
          return null;
        }
        return {
          text: result.text,
          contentType: result.contentType,
          buffer: result.buffer
        };
      });
      resourceCache.set(url, loader);
      return loader;
    };

    const processPending = async () => {
      while (pending.length > 0) {
        const next = pending.shift();
        if (!next) {
          continue;
        }
        const result = await loadResource(next.url);
        if (!result) {
          continue;
        }

        const kind = next.kind ?? detectResourceKind(next.url, result.contentType, result.text);
        if (!kind) {
          continue;
        }

        if (kind === "html") {
          await analyzeHtml({
            htmlText: result.text,
            baseUrl: next.url,
            settleTimeMs,
            recursive,
            fetchWithCache,
            recordUrl,
            enqueue,
            recordCssUrls
          });
          continue;
        }

        if (kind === "css") {
          recordCssUrls(result.text, next.url);
          continue;
        }

        analyzeJs(result.text, next.url);
      }
    };

    const initialUrl = parseAbsoluteUrl(this.input);
    const effectiveBaseUrl = baseUrl ?? initialUrl ?? undefined;
    let initialInput = this.input;

    if (initialUrl) {
      const result = await fetchWithCache(initialUrl);
      if (!result.ok || !result.text) {
        return {
          title: undefined,
          capturedAt,
          requests,
          networkRecords: requestOnly ? [] : networkRecords
        };
      }
      recordUrl(initialUrl, "resource");
      initialInput = result.text;
    }

    const inputKind = detectInputKind(initialInput);

    let title: string | undefined;
    if (inputKind === "html") {
      title = await analyzeHtml({
        htmlText: initialInput,
        baseUrl: effectiveBaseUrl,
        captureTitle: true,
        settleTimeMs,
        recursive,
        fetchWithCache,
        recordUrl,
        enqueue,
        recordCssUrls
      });
    } else if (inputKind === "css") {
      recordCssUrls(initialInput, effectiveBaseUrl);
    } else {
      analyzeJs(initialInput, effectiveBaseUrl);
    }

    await processPending();
    await Promise.allSettled(pendingNetwork);

    return {
      title,
      capturedAt,
      requests,
      networkRecords: requestOnly ? [] : networkRecords
    };
  }
}
