import type { RequestSource } from "./types.js";

export type LighterceptorOptions = {
  settleTimeMs?: number;
  recursion?: boolean;
  requestOnly?: boolean;
  baseUrl?: string;
};

export type RequestRecord = {
  url: string;
  source: RequestSource | "unknown";
  timestamp: number;
};

export type ResponseRecord = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "text" | "base64";
};

export type NetworkRecord = {
  url: string;
  source: RequestSource | "unknown";
  method: string;
  timestamp: number;
  response?: ResponseRecord;
  error?: string;
};

export type LighterceptorResult = {
  title?: string;
  capturedAt: string;
  requests: RequestRecord[];
  networkRecords?: NetworkRecord[];
};

export type ResourceKind = "html" | "css" | "js";
