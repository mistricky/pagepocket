import type {
  ApiRecord,
  ContentRef,
  ContentStore,
  NetworkEvent,
  NetworkRequestEvent,
  NetworkRequestFailedEvent,
  NetworkResponseEvent,
  ResourceFilter
} from "./types";
import { bodyToTextOrBase64, toUint8Array } from "./utils";

type Limits = {
  maxTotalBytes?: number;
  maxSingleResourceBytes?: number;
  maxResources?: number;
};

export type StoredResource = {
  request: NetworkRequestEvent;
  response: NetworkResponseEvent;
  contentRef: ContentRef;
  size: number;
  mimeType?: string;
};

type RequestRecord = {
  request: NetworkRequestEvent;
  response?: NetworkResponseEvent;
  failed?: NetworkRequestFailedEvent;
};

export type ApiEntry = {
  record: ApiRecord;
  request: NetworkRequestEvent;
};

const isApiResource = (request?: NetworkRequestEvent) => {
  const type = request?.resourceType;
  return type === "fetch" || type === "xhr";
};

const getHeaderValue = (headers: Record<string, string>, name: string) => {
  const target = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === target) {
      return headers[key];
    }
  }
  return undefined;
};

const responseMimeType = (response: NetworkResponseEvent) =>
  response.mimeType || getHeaderValue(response.headers || {}, "content-type");

export class NetworkStore {
  private contentStore: ContentStore;
  private filter: ResourceFilter;
  private limits: Limits;
  private requests = new Map<string, RequestRecord>();
  private storedResources: StoredResource[] = [];
  private apiEntries: ApiEntry[] = [];
  private apiRecordIds = new Set<string>();
  private warnings: string[] = [];
  private totalBytes = 0;

  constructor(options: { contentStore: ContentStore; filter: ResourceFilter; limits?: Limits }) {
    this.contentStore = options.contentStore;
    this.filter = options.filter;
    this.limits = options.limits ?? {};
  }

  getWarnings() {
    return this.warnings.slice();
  }

  getTotals() {
    return {
      totalBytes: this.totalBytes,
      totalFiles: this.storedResources.length
    };
  }

  getResources() {
    return this.storedResources.slice();
  }

  getApiRecords() {
    return this.apiEntries.map((entry) => entry.record);
  }

  getApiEntries() {
    return this.apiEntries.slice();
  }

  getRequestRecords() {
    return new Map(this.requests);
  }

  async handleEvent(event: NetworkEvent): Promise<void> {
    if (event.type === "request") {
      this.requests.set(event.requestId, { request: event });
      return;
    }

    const record = this.requests.get(event.requestId);
    if (!record) {
      return;
    }

    if (event.type === "failed") {
      record.failed = event;
      if (isApiResource(record.request)) {
        this.recordApiFailure(record.request, event);
      }
      return;
    }

    record.response = event;

    const request = record.request;
    const response = event;
    const isApi = isApiResource(request);
    const shouldSave = this.filter.shouldSave(request, response);

    let bodyBytes: Uint8Array | null = null;
    if (response.body) {
      bodyBytes = await toUint8Array(response.body);
    }

    if (isApi) {
      await this.recordApiResponse(request, response, bodyBytes);
    }

    if (!shouldSave) {
      return;
    }

    if (!bodyBytes) {
      this.warnings.push(`Missing body for ${request.url}`);
      return;
    }

    if (
      this.limits.maxSingleResourceBytes &&
      bodyBytes.byteLength > this.limits.maxSingleResourceBytes
    ) {
      this.warnings.push(`Resource too large: ${request.url}`);
      return;
    }

    if (this.limits.maxResources && this.storedResources.length >= this.limits.maxResources) {
      this.warnings.push(`Resource limit reached at ${request.url}`);
      return;
    }

    if (
      this.limits.maxTotalBytes &&
      this.totalBytes + bodyBytes.byteLength > this.limits.maxTotalBytes
    ) {
      this.warnings.push(`Total byte limit reached at ${request.url}`);
      return;
    }

    const contentRef = await this.contentStore.put(
      { kind: "buffer", data: bodyBytes },
      {
        url: request.url,
        mimeType: responseMimeType(response),
        sizeHint: bodyBytes.byteLength
      }
    );

    const stored: StoredResource = {
      request,
      response,
      contentRef,
      size: bodyBytes.byteLength,
      mimeType: responseMimeType(response)
    };
    this.storedResources.push(stored);
    this.totalBytes += bodyBytes.byteLength;
  }

  private recordApiFailure(request: NetworkRequestEvent, failed: NetworkRequestFailedEvent) {
    if (this.apiRecordIds.has(request.requestId)) {
      return;
    }
    this.apiRecordIds.add(request.requestId);
    const record: ApiRecord = {
      url: request.url,
      method: request.method,
      requestHeaders: request.headers,
      error: failed.errorText,
      timestamp: failed.timestamp
    };
    this.apiEntries.push({ record, request });
  }

  private async recordApiResponse(
    request: NetworkRequestEvent,
    response: NetworkResponseEvent,
    bodyBytes: Uint8Array | null
  ) {
    if (this.apiRecordIds.has(request.requestId)) {
      return;
    }
    this.apiRecordIds.add(request.requestId);
    const record: ApiRecord = {
      url: request.url,
      method: request.method,
      requestHeaders: request.headers,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: response.headers,
      timestamp: response.timestamp
    };

    if (bodyBytes && bodyBytes.byteLength > 0) {
      const mimeType = responseMimeType(response);
      const decoded = bodyToTextOrBase64(bodyBytes, mimeType);
      if (decoded.encoding === "text") {
        record.responseBody = decoded.text;
        record.responseEncoding = "text";
      } else {
        record.responseBodyBase64 = decoded.base64;
        record.responseEncoding = "base64";
      }
    }

    this.apiEntries.push({ record, request });
  }
}
