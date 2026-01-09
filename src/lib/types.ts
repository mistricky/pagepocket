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

export type SnapshotData = {
  url: string;
  title: string;
  capturedAt: string;
  fetchXhrRecords: FetchRecord[];
  networkRecords: NetworkRecord[];
  resources: Array<{
    url: string;
    localPath: string;
    contentType?: string | null;
    size?: number;
  }>;
};
