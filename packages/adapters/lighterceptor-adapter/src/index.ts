import type {
  InterceptSession,
  InterceptTarget,
  NetworkEventHandlers,
  NetworkInterceptorAdapter,
  NetworkRequestEvent,
  NetworkResponseEvent,
  NetworkRequestFailedEvent,
  ResourceType
} from "@pagepocket/lib";
import { Lighterceptor, type LighterceptorOptions } from "@pagepocket/lighterceptor";

type LighterceptorAdapterOptions = LighterceptorOptions;

const decodeBase64 = (input: string) => {
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(input, "base64"));
  }
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const encodeUtf8 = (input: string) => new TextEncoder().encode(input);

const getHeaderValue = (headers: Record<string, string>, name: string) => {
  const target = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === target) {
      return headers[key];
    }
  }
  return undefined;
};

const inferResourceType = (source: string | undefined, headers: Record<string, string>) => {
  if (source === "fetch") return "fetch";
  if (source === "xhr") return "xhr";
  if (source === "css") return "stylesheet";
  if (source === "img") return "image";

  const contentType = (getHeaderValue(headers, "content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) return "document";
  if (contentType.includes("text/css")) return "stylesheet";
  if (contentType.includes("javascript")) return "script";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("font/") || contentType.includes("woff")) return "font";
  if (contentType.startsWith("audio/") || contentType.startsWith("video/")) return "media";
  return undefined;
};

const toRequestEvent = (record: {
  url: string;
  method: string;
  source?: string;
  timestamp: number;
  headers?: Record<string, string>;
  requestId: string;
}) => {
  const headers = record.headers ?? {};
  const resourceType = inferResourceType(record.source, headers);
  const event: NetworkRequestEvent = {
    type: "request",
    requestId: record.requestId,
    url: record.url,
    method: record.method,
    headers,
    resourceType: resourceType as ResourceType | undefined,
    timestamp: record.timestamp
  };
  return event;
};

export class LighterceptorAdapter implements NetworkInterceptorAdapter {
  readonly name = "lighterceptor";
  readonly capabilities = {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: false
  };

  private options: LighterceptorAdapterOptions;

  constructor(options: LighterceptorAdapterOptions = {}) {
    this.options = options;
  }

  async start(
    target: InterceptTarget,
    handlers: NetworkEventHandlers
  ): Promise<InterceptSession> {
    if (target.kind !== "url") {
      throw new Error("LighterceptorAdapter only supports target.kind === 'url'.");
    }

    const lighterceptor = new Lighterceptor(target.url, {
      recursion: true,
      ...this.options
    });

    const result = await lighterceptor.run();
    const networkRecords = result.networkRecords ?? [];
    let sequence = 0;

    for (const record of networkRecords) {
      const requestId = `${record.url}:${record.timestamp}:${sequence++}`;
      const requestEvent = toRequestEvent({
        url: record.url,
        method: record.method || "GET",
        source: record.source,
        timestamp: record.timestamp,
        requestId
      });
      handlers.onEvent(requestEvent);

      if (record.response) {
        const headers = record.response.headers || {};
        const resourceType = inferResourceType(record.source, headers);
        const responseEvent: NetworkResponseEvent = {
          type: "response",
          requestId: requestEvent.requestId,
          url: record.url,
          status: record.response.status,
          statusText: record.response.statusText,
          headers,
          mimeType: getHeaderValue(headers, "content-type"),
          timestamp: record.timestamp,
          body: {
            kind: "buffer",
            data:
              record.response.bodyEncoding === "base64"
                ? decodeBase64(record.response.body)
                : encodeUtf8(record.response.body)
          }
        };
        handlers.onEvent(responseEvent);
        continue;
      }

      if (record.error) {
        const failedEvent: NetworkRequestFailedEvent = {
          type: "failed",
          requestId: requestEvent.requestId,
          url: record.url,
          errorText: record.error,
          timestamp: record.timestamp
        };
        handlers.onEvent(failedEvent);
      }
    }

    return {
      async stop() {}
    };
  }
}
