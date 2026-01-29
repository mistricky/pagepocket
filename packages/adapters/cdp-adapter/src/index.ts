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
type ChromeDebuggerTarget = {
  tabId: number;
};

type ChromeDebuggerEvent = (
  source: ChromeDebuggerTarget,
  method: string,
  params?: Record<string, unknown>
) => void;

type ChromeDebuggerApi = {
  attach: (target: ChromeDebuggerTarget, version: string, callback: () => void) => void;
  detach: (target: ChromeDebuggerTarget, callback: () => void) => void;
  sendCommand: (
    target: ChromeDebuggerTarget,
    method: string,
    params: Record<string, unknown>,
    callback: (result?: unknown) => void
  ) => void;
  onEvent: {
    addListener: (listener: ChromeDebuggerEvent) => void;
    removeListener: (listener: ChromeDebuggerEvent) => void;
  };
};

type ChromeRuntimeApi = {
  lastError?: { message?: string };
};

type ChromeGlobal = {
  debugger?: ChromeDebuggerApi;
  runtime?: ChromeRuntimeApi;
};

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
    loadingFinished?: (listener: (payload: unknown) => void) => void;
  };
  Page?: {
    enable?: () => Promise<void>;
    navigate?: (params: { url: string }) => Promise<void>;
    getResourceContent?: (params: {
      frameId: string;
      url: string;
    }) => Promise<{
      content: string;
      base64Encoded?: boolean;
    }>;
  };
};

export type CdpAdapterOptions = {
  protocolVersion?: string;
  clientFactory?: (options?: {
    tabId: number;
    protocolVersion: string;
  }) => Promise<CdpClient> | CdpClient;
};

type RequestWillBeSent = {
  requestId: string;
  frameId?: string;
  timestamp?: number;
  wallTime?: number;
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
  frameId?: string;
  timestamp?: number;
  wallTime?: number;
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
  wallTime?: number;
  errorText: string;
};

type LoadingFinished = {
  requestId: string;
  timestamp?: number;
  wallTime?: number;
};

type StoredResponse = {
  requestId: string;
  response: ResponseReceived["response"];
};

type RequestInfo = {
  url: string;
  frameId?: string;
  resourceType?: ResourceType;
  initiator?: { type?: string; url?: string };
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

const inferResourceTypeFromMime = (mimeType?: string): ResourceType | undefined => {
  if (!mimeType) return undefined;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("text/html") || normalized.includes("application/xhtml+xml")) {
    return "document";
  }
  if (normalized.includes("text/css")) {
    return "stylesheet";
  }
  if (normalized.includes("javascript") || normalized.includes("ecmascript")) {
    return "script";
  }
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (
    normalized.startsWith("font/") ||
    normalized.includes("woff") ||
    normalized.includes("ttf") ||
    normalized.includes("otf")
  ) {
    return "font";
  }
  if (normalized.startsWith("audio/") || normalized.startsWith("video/")) {
    return "media";
  }
  return undefined;
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

const isNoBodyError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No data found for resource with given identifier");
};

const logInfo = (label: string, data: Record<string, unknown>) => {
  console.info(`[pagepocket][cdp-adapter] ${label} ${JSON.stringify(data)}`);
};

const getChromeGlobal = () => (globalThis as { chrome?: ChromeGlobal }).chrome;

const createChromeDebuggerClient = (
  target: ChromeDebuggerTarget,
  protocolVersion: string
): CdpClient => {
  const chromeGlobal = getChromeGlobal();
  const chromeDebugger = chromeGlobal?.debugger;
  if (!chromeDebugger) {
    throw new Error("chrome.debugger API is not available in this environment.");
  }
  const chromeRuntime = chromeGlobal?.runtime;
  let attached = false;
  let closed = false;
  const listeners = new Map<(payload: unknown) => void, ChromeDebuggerEvent>();

  const assertNoLastError = (action: string) => {
    const lastError = chromeRuntime?.lastError;
    if (lastError?.message) {
      throw new Error(`${action} failed: ${lastError.message}`);
    }
  };

  const attach = () =>
    new Promise<void>((resolve, reject) => {
      chromeDebugger.attach(target, protocolVersion, () => {
        try {
          assertNoLastError("chrome.debugger.attach");
          attached = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

  const detach = () =>
    new Promise<void>((resolve, reject) => {
      chromeDebugger.detach(target, () => {
        try {
          assertNoLastError("chrome.debugger.detach");
          attached = false;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

  const ensureAttached = async () => {
    if (attached) return;
    await attach();
  };

  return {
    send: async (method, params) => {
      await ensureAttached();
      return new Promise((resolve, reject) => {
        chromeDebugger.sendCommand(target, method, params ?? {}, (result) => {
          try {
            assertNoLastError(`chrome.debugger.sendCommand(${method})`);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
    },
    on: (event, listener) => {
      const handler: ChromeDebuggerEvent = (source, method, params) => {
        if (source.tabId !== target.tabId) return;
        if (method !== event) return;
        listener(params);
      };
      listeners.set(listener, handler);
      chromeDebugger.onEvent.addListener(handler);
    },
    off: (_event, listener) => {
      const handler = listeners.get(listener);
      if (!handler) return;
      listeners.delete(listener);
      chromeDebugger.onEvent.removeListener(handler);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      if (!attached) return;
      await detach();
    }
  };
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
    if (target.kind !== "cdp-tab") {
      throw new Error("CdpAdapter only supports cdp-tab targets.");
    }

    const protocolVersion = this.options.protocolVersion ?? "1.3";
    const clientFactory = this.options.clientFactory;
    const client =
      (await clientFactory?.({ tabId: target.tabId, protocolVersion })) ??
      createChromeDebuggerClient({ tabId: target.tabId }, protocolVersion);
    const ownsClient = true;

    await callCdp<void>(client, "Network.enable");

    const activeRequestId = new Map<string, string>();
    const requestSequence = new Map<string, number>();
    const requestUrls = new Map<string, string>();
    const requestInfo = new Map<string, RequestInfo>();
    const requestEvents = new Map<string, NetworkRequestEvent>();
    const responses = new Map<string, StoredResponse>();
    const requestTimeOffsets = new Map<string, number>();
    let globalTimeOffset: number | null = null;

    const getLogicalRequestId = (cdpRequestId: string) =>
      activeRequestId.get(cdpRequestId) ?? `${cdpRequestId}:0`;

    const resolveTimestampMs = (
      payload: { timestamp?: number; wallTime?: number },
      requestId?: string
    ) => {
      if (typeof payload.wallTime === "number") {
        if (typeof payload.timestamp === "number") {
          const offset = payload.wallTime - payload.timestamp;
          if (requestId) {
            requestTimeOffsets.set(requestId, offset);
          }
          globalTimeOffset = offset;
        }
        return payload.wallTime * 1000;
      }

      if (typeof payload.timestamp === "number") {
        const offset =
          (requestId ? requestTimeOffsets.get(requestId) : undefined) ?? globalTimeOffset;
        if (typeof offset === "number") {
          return (payload.timestamp + offset) * 1000;
        }
      }

      return Date.now();
    };

    const handleRequestWillBeSent = (payload: RequestWillBeSent) => {
      const cdpRequestId = payload.requestId;
      const eventTimestamp = resolveTimestampMs(payload, cdpRequestId);
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
          timestamp: eventTimestamp
        };
        handlers.onEvent(redirectEvent);
      }

      const sequence = (requestSequence.get(cdpRequestId) ?? -1) + 1;
      requestSequence.set(cdpRequestId, sequence);
      const logicalRequestId = `${cdpRequestId}:${sequence}`;
      activeRequestId.set(cdpRequestId, logicalRequestId);

      const url = payload.request.url;
      requestUrls.set(logicalRequestId, url);
      requestInfo.set(cdpRequestId, {
        url,
        frameId: payload.frameId,
        resourceType: mapResourceType(payload.type),
        initiator: payload.initiator
      });

      const requestEvent: NetworkRequestEvent = {
        type: "request",
        requestId: logicalRequestId,
        url,
        method: payload.request.method || "GET",
        headers: normalizeHeaders(payload.request.headers),
        frameId: payload.frameId,
        resourceType: mapResourceType(payload.type),
        initiator: payload.initiator,
        timestamp: eventTimestamp
      };
      requestEvents.set(cdpRequestId, requestEvent);
      handlers.onEvent(requestEvent);
    };

    const handleResponseReceived = (payload: ResponseReceived) => {
      const cdpRequestId = payload.requestId;
      const logicalRequestId = getLogicalRequestId(cdpRequestId);
      const eventTimestamp = resolveTimestampMs(payload, cdpRequestId);
      const response = payload.response;
      if (!requestUrls.has(logicalRequestId)) {
        requestUrls.set(logicalRequestId, response.url);
      }
      const storedRequest = requestEvents.get(cdpRequestId);
      const existingInfo = requestInfo.get(cdpRequestId);
      const inferred = inferResourceTypeFromMime(response.mimeType);
      if ((!existingInfo || !existingInfo.resourceType) && inferred) {
        requestInfo.set(cdpRequestId, {
          url: response.url,
          frameId: existingInfo?.frameId ?? payload.frameId,
          resourceType: inferred,
          initiator: existingInfo?.initiator
        });
      }
      if (!storedRequest && inferred) {
        const synthesizedRequest: NetworkRequestEvent = {
          type: "request",
          requestId: logicalRequestId,
          url: response.url,
          method: "GET",
          headers: {},
          frameId: payload.frameId,
          resourceType: inferred,
          initiator: undefined,
          timestamp: eventTimestamp
        };
        requestEvents.set(cdpRequestId, synthesizedRequest);
        handlers.onEvent(synthesizedRequest);
      } else if (storedRequest && inferred && !storedRequest.resourceType) {
        const updatedRequest: NetworkRequestEvent = {
          ...storedRequest,
          resourceType: inferred,
          timestamp: eventTimestamp
        };
        requestEvents.set(cdpRequestId, updatedRequest);
        handlers.onEvent(updatedRequest);
      }
      logInfo("response received", {
        requestId: cdpRequestId,
        url: response.url,
        status: response.status,
        mimeType: response.mimeType,
        fromDiskCache: response.fromDiskCache,
        fromServiceWorker: response.fromServiceWorker
      });
      responses.set(cdpRequestId, {
        requestId: logicalRequestId,
        response
      });
    };

    const tryGetResponseBody = async (
      cdpRequestId: string
    ): Promise<Uint8Array | null> => {
      try {
        const result = await callCdp<{
          body: string;
          base64Encoded?: boolean;
        }>(client, "Network.getResponseBody", { requestId: cdpRequestId });
        if (result.base64Encoded) {
          return decodeBase64(result.body);
        }
        return encodeUtf8(result.body);
      } catch (error) {
        if (isNoBodyError(error)) {
          return null;
        }
        throw error;
      }
    };

    const tryGetPageResourceContent = async (
      info: RequestInfo
    ): Promise<Uint8Array | null> => {
      if (!info.frameId || !info.url) {
        return null;
      }
      try {
        const result = await callCdp<{
          content: string;
          base64Encoded?: boolean;
        }>(client, "Page.getResourceContent", {
          frameId: info.frameId,
          url: info.url
        });
        if (result.base64Encoded) {
          return decodeBase64(result.content);
        }
        return encodeUtf8(result.content);
      } catch {
        return null;
      }
    };

    const handleLoadingFinished = async (payload: LoadingFinished) => {
      const cdpRequestId = payload.requestId;
      const eventTimestamp = resolveTimestampMs(payload, cdpRequestId);
      const storedResponse = responses.get(cdpRequestId);
      if (!storedResponse) {
        logInfo("loadingFinished without response", {
          requestId: cdpRequestId
        });
        return;
      }

      const inferred = inferResourceTypeFromMime(storedResponse.response.mimeType);
      const info = requestInfo.get(cdpRequestId);
      if ((!info || !info.resourceType) && inferred) {
        requestInfo.set(cdpRequestId, {
          url: storedResponse.response.url,
          frameId: info?.frameId,
          resourceType: inferred,
          initiator: info?.initiator
        });
        const storedRequest = requestEvents.get(cdpRequestId);
        if (storedRequest && !storedRequest.resourceType) {
          const updatedRequest: NetworkRequestEvent = {
            ...storedRequest,
            resourceType: inferred
          };
          requestEvents.set(cdpRequestId, updatedRequest);
          handlers.onEvent(updatedRequest);
        }
      }

      let bodyBytes: Uint8Array | null = null;
      try {
        bodyBytes = await tryGetResponseBody(cdpRequestId);
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      if (bodyBytes && bodyBytes.byteLength === 0) {
        bodyBytes = null;
      }

      if (!bodyBytes) {
        const fallbackInfo = requestInfo.get(cdpRequestId);
        if (fallbackInfo?.frameId) {
          bodyBytes = await tryGetPageResourceContent(fallbackInfo);
        }
      }
      logInfo("response body status", {
        requestId: cdpRequestId,
        url: storedResponse.response.url,
        resourceType: requestInfo.get(cdpRequestId)?.resourceType,
        bodyBytes: bodyBytes ? bodyBytes.byteLength : 0
      });

      const responseEvent: NetworkResponseEvent = {
        type: "response",
        requestId: storedResponse.requestId,
        url: storedResponse.response.url,
        status: storedResponse.response.status,
        statusText: storedResponse.response.statusText,
        headers: normalizeHeaders(storedResponse.response.headers),
        mimeType: storedResponse.response.mimeType,
        fromDiskCache: storedResponse.response.fromDiskCache,
        fromServiceWorker: storedResponse.response.fromServiceWorker,
        timestamp: eventTimestamp,
        body: bodyBytes ? { kind: "buffer", data: bodyBytes } : undefined
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
        timestamp: resolveTimestampMs(payload, cdpRequestId)
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
      cleanupHandlers.push(
        subscribe(client, "Network.loadingFinished", (payload) => {
          void handleLoadingFinished(payload as LoadingFinished);
        })
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
