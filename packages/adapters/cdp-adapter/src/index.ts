import type {
  InterceptSession,
  InterceptTarget,
  NetworkEventHandlers,
  NetworkInterceptorAdapter,
  NetworkRequestEvent,
  NetworkRequestFailedEvent,
  NetworkResponseEvent,
  ResourceType
} from "@pagepocket/lib";
import CDP, { type Options as CdpOptions } from "chrome-remote-interface";

type CdpConnectionOptions = CdpOptions;

type CdpClient = {
  send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on?: (event: string, listener: (payload: unknown) => void) => void;
  off?: (event: string, listener: (payload: unknown) => void) => void;
  close?: () => Promise<void>;
  Network?: {
    enable?: (params?: Record<string, unknown>) => Promise<void>;
    disable?: () => Promise<void>;
    getResponseBody?: (params: { requestId: string }) => Promise<{
      body: string;
      base64Encoded?: boolean;
    }>;
    requestWillBeSent?: (listener: (payload: unknown) => void) => void;
    responseReceived?: (listener: (payload: unknown) => void) => void;
    loadingFailed?: (listener: (payload: unknown) => void) => void;
  };
  Page?: {
    enable?: () => Promise<void>;
    navigate?: (params: { url: string }) => Promise<void>;
  };
};

export type CdpAdapterOptions = {
  host?: string;
  port?: number;
  target?: CdpConnectionOptions["target"];
  clientFactory?: (options: CdpConnectionOptions) => Promise<CdpClient>;
};

type RequestWillBeSent = {
  requestId: string;
  frameId?: string;
  timestamp?: number;
  type?: string;
  initiator?: { type?: string; url?: string };
  request: {
    url: string;
    method: string;
    headers?: Record<string, unknown>;
  };
  redirectResponse?: ResponseReceived["response"];
};

type ResponseReceived = {
  requestId: string;
  timestamp?: number;
  type?: string;
  response: {
    url: string;
    status: number;
    statusText?: string;
    headers?: Record<string, unknown>;
    mimeType?: string;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
  };
};

type LoadingFailed = {
  requestId: string;
  timestamp?: number;
  errorText: string;
};

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

const normalizeHeaders = (headers?: Record<string, unknown>) => {
  const output: Record<string, string> = {};
  if (!headers) return output;
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (value === undefined || value === null) continue;
    output[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return output;
};

const mapResourceType = (input?: string): ResourceType | undefined => {
  if (!input) return undefined;
  const normalized = input.toLowerCase();
  switch (normalized) {
    case "document":
      return "document";
    case "stylesheet":
      return "stylesheet";
    case "script":
      return "script";
    case "image":
      return "image";
    case "font":
      return "font";
    case "media":
      return "media";
    case "xhr":
      return "xhr";
    case "fetch":
      return "fetch";
    case "other":
      return "other";
    default:
      return normalized as ResourceType;
  }
};

const callCdp = async <T>(
  client: CdpClient,
  method: string,
  params?: Record<string, unknown>
): Promise<T> => {
  if (typeof client.send === "function") {
    return (await client.send(method, params)) as T;
  }
  const [domain, command] = method.split(".");
  const domainApi = (client as Record<string, unknown>)[domain] as
    | Record<string, unknown>
    | undefined;
  const fn = domainApi?.[command];
  if (typeof fn === "function") {
    return (await (fn as (input?: Record<string, unknown>) => Promise<T>)(params)) as T;
  }
  throw new Error(`CDP session missing method ${method}.`);
};

const subscribe = (client: CdpClient, eventName: string, handler: (payload: unknown) => void) => {
  if (typeof client.on === "function") {
    client.on(eventName, handler);
    return () => client.off?.(eventName, handler);
  }
  const [domain, event] = eventName.split(".");
  const domainApi = (client as Record<string, unknown>)[domain] as
    | Record<string, unknown>
    | undefined;
  const fn = domainApi?.[event];
  if (typeof fn === "function") {
    (fn as (listener: (payload: unknown) => void) => void)(handler);
    return () => undefined;
  }
  throw new Error(`CDP session missing event ${eventName}.`);
};

export class CdpAdapter implements NetworkInterceptorAdapter {
  readonly name = "cdp";
  readonly capabilities = {
    canGetResponseBody: true,
    canStreamResponseBody: false,
    canGetRequestBody: false,
    providesResourceType: true
  };

  private options: CdpAdapterOptions;

  constructor(options: CdpAdapterOptions = {}) {
    this.options = options;
  }

  async start(
    target: InterceptTarget,
    handlers: NetworkEventHandlers,
    _options?: Record<string, unknown>
  ): Promise<InterceptSession> {
    if (target.kind !== "cdp-session" && target.kind !== "cdp-tab") {
      throw new Error("CdpAdapter only supports cdp-session or cdp-tab targets.");
    }

    const clientFactory =
      this.options.clientFactory ??
      ((options: CdpConnectionOptions) =>
        CDP({
          host: options.host,
          port: options.port,
          target: options.target
        }) as unknown as Promise<CdpClient>);

    const resolveTabTarget = (tabId: number): CdpConnectionOptions["target"] => {
      return (targets) => {
        const match = targets.find((entry) => entry.id === String(tabId));
        if (match) return match;
        if (tabId >= 0 && tabId < targets.length) return tabId;
        return targets[0] ?? 0;
      };
    };

    const client =
      target.kind === "cdp-session"
        ? (target.session as CdpClient)
        : await clientFactory({
            host: this.options.host,
            port: this.options.port,
            target: this.options.target ?? resolveTabTarget(target.tabId)
          });
    const ownsClient = target.kind !== "cdp-session";

    await callCdp<void>(client, "Network.enable");

    const activeRequestId = new Map<string, string>();
    const requestSequence = new Map<string, number>();
    const requestUrls = new Map<string, string>();

    const getLogicalRequestId = (cdpRequestId: string) =>
      activeRequestId.get(cdpRequestId) ?? `${cdpRequestId}:0`;

    const createResponseBody = (cdpRequestId: string) =>
      ({
        kind: "late" as const,
        read: async () => {
          const result = await callCdp<{
            body: string;
            base64Encoded?: boolean;
          }>(client, "Network.getResponseBody", { requestId: cdpRequestId });
          if (result.base64Encoded) {
            return decodeBase64(result.body);
          }
          return encodeUtf8(result.body);
        }
      }) as const;

    const handleRequestWillBeSent = (payload: RequestWillBeSent) => {
      const cdpRequestId = payload.requestId;
      if (payload.redirectResponse) {
        const previousRequestId = getLogicalRequestId(cdpRequestId);
        const redirectResponse = payload.redirectResponse;
        const redirectEvent: NetworkResponseEvent = {
          type: "response",
          requestId: previousRequestId,
          url: redirectResponse.url,
          status: redirectResponse.status,
          statusText: redirectResponse.statusText,
          headers: normalizeHeaders(redirectResponse.headers),
          mimeType: redirectResponse.mimeType,
          fromDiskCache: redirectResponse.fromDiskCache,
          fromServiceWorker: redirectResponse.fromServiceWorker,
          timestamp: Date.now()
        };
        handlers.onEvent(redirectEvent);
      }

      const sequence = (requestSequence.get(cdpRequestId) ?? -1) + 1;
      requestSequence.set(cdpRequestId, sequence);
      const logicalRequestId = `${cdpRequestId}:${sequence}`;
      activeRequestId.set(cdpRequestId, logicalRequestId);

      const url = payload.request.url;
      requestUrls.set(logicalRequestId, url);

      const requestEvent: NetworkRequestEvent = {
        type: "request",
        requestId: logicalRequestId,
        url,
        method: payload.request.method || "GET",
        headers: normalizeHeaders(payload.request.headers),
        frameId: payload.frameId,
        resourceType: mapResourceType(payload.type),
        initiator: payload.initiator,
        timestamp: Date.now()
      };
      handlers.onEvent(requestEvent);
    };

    const handleResponseReceived = (payload: ResponseReceived) => {
      const cdpRequestId = payload.requestId;
      const logicalRequestId = getLogicalRequestId(cdpRequestId);
      const response = payload.response;
      if (!requestUrls.has(logicalRequestId)) {
        requestUrls.set(logicalRequestId, response.url);
      }
      const responseEvent: NetworkResponseEvent = {
        type: "response",
        requestId: logicalRequestId,
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        mimeType: response.mimeType,
        fromDiskCache: response.fromDiskCache,
        fromServiceWorker: response.fromServiceWorker,
        timestamp: Date.now(),
        body: createResponseBody(cdpRequestId)
      };
      handlers.onEvent(responseEvent);
    };

    const handleLoadingFailed = (payload: LoadingFailed) => {
      const cdpRequestId = payload.requestId;
      const logicalRequestId = getLogicalRequestId(cdpRequestId);
      const url = requestUrls.get(logicalRequestId) ?? "";
      const failedEvent: NetworkRequestFailedEvent = {
        type: "failed",
        requestId: logicalRequestId,
        url,
        errorText: payload.errorText,
        timestamp: Date.now()
      };
      handlers.onEvent(failedEvent);
    };

    const cleanupHandlers: Array<() => void> = [];
    try {
      cleanupHandlers.push(
        subscribe(client, "Network.requestWillBeSent", (payload) =>
          handleRequestWillBeSent(payload as RequestWillBeSent)
        )
      );
      cleanupHandlers.push(
        subscribe(client, "Network.responseReceived", (payload) =>
          handleResponseReceived(payload as ResponseReceived)
        )
      );
      cleanupHandlers.push(
        subscribe(client, "Network.loadingFailed", (payload) =>
          handleLoadingFailed(payload as LoadingFailed)
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        handlers.onError?.(error);
      }
      throw error;
    }

    const ensurePageEnabled = async () => {
      try {
        await callCdp<void>(client, "Page.enable");
      } catch {
        // Ignore if Page domain is not available.
      }
    };

    return {
      navigate: async (url: string) => {
        await ensurePageEnabled();
        await callCdp<void>(client, "Page.navigate", { url });
      },
      stop: async () => {
        cleanupHandlers.forEach((cleanup) => cleanup());
        if (ownsClient) {
          await client.close?.();
        }
      }
    };
  }
}
