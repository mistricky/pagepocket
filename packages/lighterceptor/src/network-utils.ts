import type { ResponseRecord } from "./lighterceptor-model.js";
import { decodeText, resolveBodyEncoding } from "./resource-utils.js";

export type FetchResult = {
  ok: boolean;
  response?: ResponseRecord;
  contentType?: string;
  text?: string;
  buffer?: Buffer;
  error?: string;
};

export function createFetchWithCache(responseCache: Map<string, Promise<FetchResult>>) {
  return (url: string) => {
    const existing = responseCache.get(url);
    if (existing) {
      return existing;
    }
    const promise = (async (): Promise<FetchResult> => {
      if (typeof fetch !== "function") {
        return {
          ok: false,
          error: "fetch-unavailable"
        };
      }

      try {
        const response = await fetch(url);
        const cloned = response.clone();
        const [buffer, text] = await Promise.all([response.arrayBuffer(), cloned.text()]);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        const bodyEncoding = resolveBodyEncoding(response.headers.get("content-type") ?? undefined);
        const body =
          bodyEncoding === "base64"
            ? Buffer.from(buffer).toString("base64")
            : decodeText(
                Buffer.from(buffer),
                response.headers.get("content-type") ?? undefined,
                text
              );
        const responseRecord: ResponseRecord = {
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
          bodyEncoding
        };
        return {
          ok: response.ok,
          response: responseRecord,
          contentType: response.headers.get("content-type") ?? undefined,
          text: bodyEncoding === "text" ? body : text,
          buffer: Buffer.from(buffer)
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })();
    responseCache.set(url, promise);
    return promise;
  };
}
