export type ResourceType =
  | "document"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "media"
  | "xhr"
  | "fetch"
  | "other"
  | (string & {});

export type BodySource =
  | { kind: "buffer"; data: Uint8Array }
  | { kind: "stream"; stream: ReadableStream<Uint8Array> }
  | { kind: "late"; read: () => Promise<Uint8Array> };

export interface NetworkRequestEvent {
  type: "request";
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  frameId?: string;
  resourceType?: ResourceType;
  initiator?: { type?: string; url?: string };
  timestamp: number;
}

export interface NetworkResponseEvent {
  type: "response";
  requestId: string;
  url: string;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  mimeType?: string;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  timestamp: number;
  body?: BodySource;
}

export interface NetworkRequestFailedEvent {
  type: "failed";
  requestId: string;
  url: string;
  errorText: string;
  timestamp: number;
}

export type NetworkEvent = NetworkRequestEvent | NetworkResponseEvent | NetworkRequestFailedEvent;

export interface NetworkEventHandlers {
  onEvent(event: NetworkEvent): void;
  onError?(error: Error): void;
  onLog?(msg: string, meta?: unknown): void;
}

export interface InterceptorCapabilities {
  canGetResponseBody: boolean;
  canStreamResponseBody: boolean;
  canGetRequestBody: boolean;
  providesResourceType: boolean;
}

export type InterceptTarget =
  | { kind: "url"; url: string }
  | { kind: "puppeteer-page"; page: unknown }
  | { kind: "cdp-tab"; tabId: number }
  | { kind: "cdp-session"; session: unknown };

export type InterceptOptions = Record<string, unknown>;
export type NavigateOptions = Record<string, unknown>;

export interface InterceptSession {
  navigate?(url: string, options?: NavigateOptions): Promise<void>;
  stop(): Promise<void>;
}

export interface NetworkInterceptorAdapter {
  readonly name: string;
  readonly capabilities: InterceptorCapabilities;
  start(
    target: InterceptTarget,
    handlers: NetworkEventHandlers,
    options?: InterceptOptions
  ): Promise<InterceptSession>;
}

export interface PathResolver {
  resolve(input: {
    url: string;
    resourceType?: ResourceType;
    mimeType?: string;
    suggestedFilename?: string;
    isCrossOrigin: boolean;
    entryUrl: string;
  }): string;
}

export interface ResourceFilter {
  shouldSave(req: NetworkRequestEvent, res?: NetworkResponseEvent): boolean;
}

export type ContentRef = { kind: "memory"; data: Uint8Array } | { kind: "store-ref"; id: string };

export interface ContentStore {
  name: string;
  put(
    body: BodySource,
    meta: { url: string; mimeType?: string; sizeHint?: number }
  ): Promise<ContentRef>;
  open(ref: ContentRef): Promise<ReadableStream<Uint8Array>>;
  dispose?(): Promise<void>;
}

export interface ContentStoreHandle {
  open(ref: ContentRef): Promise<ReadableStream<Uint8Array>>;
  dispose?(): Promise<void>;
}

export interface CompletionContext {
  now(): number;
  getStats(): {
    inflightRequests: number;
    lastNetworkTs: number;
    totalRequests: number;
  };
}

export interface CompletionStrategy {
  wait(ctx: CompletionContext): Promise<void>;
}

export interface PagePocketOptions {
  // placeholder for future options
}

export interface CaptureOptions {
  interceptor: NetworkInterceptorAdapter;
  completion?: CompletionStrategy | CompletionStrategy[];
  filter?: ResourceFilter;
  pathResolver?: PathResolver;
  contentStore?: ContentStore;
  rewriteEntry?: boolean;
  rewriteCSS?: boolean;
  limits?: {
    maxTotalBytes?: number;
    maxSingleResourceBytes?: number;
    maxResources?: number;
  };
}

export interface SnapshotFile {
  path: string;
  mimeType?: string;
  size?: number;
  source: ContentRef;
  originalUrl?: string;
  resourceType?: ResourceType;
  headers?: Record<string, string>;
}

export interface PageSnapshot {
  version: "1.0";
  createdAt: number;
  url: string;
  title?: string;
  entry: string;
  files: SnapshotFile[];
  meta?: {
    totalBytes?: number;
    totalFiles?: number;
    warnings?: string[];
  };
  content: ContentStoreHandle;
  toDirectory(outDir: string, options?: WriteFSOptions): Promise<WriteResult>;
  toZip(options?: ZipOptions): Promise<Uint8Array | Blob>;
}

export interface WriteFSOptions {
  clearCache?: boolean;
}

export interface WriteResult {
  filesWritten: number;
  totalBytes: number;
}

export interface ZipOptions {
  asBlob?: boolean;
  clearCache?: boolean;
}

export interface ApiRecord {
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  requestBodyBase64?: string;
  requestEncoding?: "text" | "base64";
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyBase64?: string;
  responseEncoding?: "text" | "base64";
  error?: string;
  timestamp: number;
}

export interface ApiSnapshot {
  version: "1.0";
  url: string;
  createdAt: number;
  records: ApiRecord[];
}
