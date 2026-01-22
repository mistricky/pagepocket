import type {
  CapturedNetworkRecord,
  NetworkInterceptorAdapter,
  SnapshotData
} from "@pagepocket/lib";
import { Lighterceptor, type LighterceptorOptions } from "@pagepocket/lighterceptor";

type LighterceptorAdapterOptions = LighterceptorOptions & {
  title?: string;
};

export class LighterceptorAdapter implements NetworkInterceptorAdapter {
  private options: LighterceptorAdapterOptions;

  constructor(options: LighterceptorAdapterOptions = {}) {
    this.options = options;
  }

  async run(url: string): Promise<SnapshotData> {
    const { title, ...lighterceptorOptions } = this.options;
    const result = await new Lighterceptor(url, {
      recursion: true,
      ...lighterceptorOptions
    }).run();

    const capturedNetworkRecords = (result.networkRecords ?? []) as CapturedNetworkRecord[];

    return {
      url,
      title: title ?? result.title ?? "snapshot",
      capturedAt: result.capturedAt ?? new Date().toISOString(),
      fetchXhrRecords: [],
      networkRecords: capturedNetworkRecords,
      resources: []
    };
  }
}
