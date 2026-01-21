import type { LighterceptorNetworkRecord, SnapshotData } from "../lib/types";

type BuildSnapshotDataInput = {
  targetUrl: string;
  title: string;
  fetchXhrRecords: SnapshotData["fetchXhrRecords"];
  lighterceptorNetworkRecords: LighterceptorNetworkRecord[];
  resources: SnapshotData["resources"];
};

export const buildSnapshotData = (input: BuildSnapshotDataInput): SnapshotData => {
  return {
    url: input.targetUrl,
    title: input.title,
    capturedAt: new Date().toISOString(),
    fetchXhrRecords: input.fetchXhrRecords,
    networkRecords: input.lighterceptorNetworkRecords,
    resources: input.resources
  };
};
