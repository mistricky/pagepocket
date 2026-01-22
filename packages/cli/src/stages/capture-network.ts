import { Lighterceptor } from "lighterceptor";

import { mapLighterceptorRecords } from "@pagepocket/lib";
import type { LighterceptorNetworkRecord, NetworkRecord } from "@pagepocket/lib";

type CaptureNetworkResult = {
  networkRecords: NetworkRecord[];
  lighterceptorNetworkRecords: LighterceptorNetworkRecord[];
  capturedTitle?: string;
  title: string;
};

export const captureNetwork = async (
  targetUrl: string,
  currentTitle: string
): Promise<CaptureNetworkResult> => {
  const result = await new Lighterceptor(targetUrl, { recursion: true }).run();
  const lighterceptorNetworkRecords = (result.networkRecords ?? []) as LighterceptorNetworkRecord[];
  const networkRecords = mapLighterceptorRecords(lighterceptorNetworkRecords);
  const capturedTitle = result.title;
  const title = currentTitle === "snapshot" && capturedTitle ? capturedTitle : currentTitle;

  return {
    networkRecords,
    lighterceptorNetworkRecords,
    capturedTitle,
    title
  };
};
