import { Lighterceptor } from "lighterceptor";

import { mapCapturedNetworkRecords } from "@pagepocket/lib";
import type { CapturedNetworkRecord, NetworkRecord } from "@pagepocket/lib";

type CaptureNetworkResult = {
  networkRecords: NetworkRecord[];
  capturedNetworkRecords: CapturedNetworkRecord[];
  capturedTitle?: string;
  title: string;
};

export const captureNetwork = async (
  targetUrl: string,
  currentTitle: string
): Promise<CaptureNetworkResult> => {
  const result = await new Lighterceptor(targetUrl, { recursion: true }).run();
  const capturedNetworkRecords = (result.networkRecords ?? []) as CapturedNetworkRecord[];
  const networkRecords = mapCapturedNetworkRecords(capturedNetworkRecords);
  const capturedTitle = result.title;
  const title = currentTitle === "snapshot" && capturedTitle ? capturedTitle : currentTitle;

  return {
    networkRecords,
    capturedNetworkRecords,
    capturedTitle,
    title
  };
};
