export type FetchRecord = {
  kind: "fetch" | "xhr";
  url: string;
  method: string;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
  timestamp: number;
};

export type NetworkRecord = {
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyBase64?: string;
  responseEncoding?: "text" | "base64";
  error?: string;
  timestamp: number;
};

export type CapturedResponseRecord = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "text" | "base64";
};

export type CapturedNetworkRecord = {
  url: string;
  source?: string;
  method: string;
  timestamp: number;
  response?: CapturedResponseRecord;
  error?: string;
};

export type SnapshotData = {
  url: string;
  title: string;
  capturedAt: string;
  fetchXhrRecords: FetchRecord[];
  networkRecords: CapturedNetworkRecord[];
  resources: Array<{
    url: string;
    localPath: string;
    contentType?: string | null;
    size?: number;
  }>;
};

export interface NetworkInterceptorAdapter {
  run(url: string): Promise<SnapshotData>;
}
