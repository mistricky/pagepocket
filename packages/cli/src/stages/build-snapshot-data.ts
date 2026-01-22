import type { CapturedNetworkRecord, SnapshotData } from "@pagepocket/lib";

type BuildSnapshotDataInput = {
  targetUrl: string;
  title: string;
  fetchXhrRecords: SnapshotData["fetchXhrRecords"];
  capturedNetworkRecords: CapturedNetworkRecord[];
  resources: SnapshotData["resources"];
};

export const buildSnapshotData = (input: BuildSnapshotDataInput): SnapshotData => {
  return {
    url: input.targetUrl,
    title: input.title,
    capturedAt: new Date().toISOString(),
    fetchXhrRecords: input.fetchXhrRecords,
    networkRecords: input.capturedNetworkRecords,
    resources: input.resources
  };
};
