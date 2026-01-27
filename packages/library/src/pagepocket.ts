import { HybridContentStore } from "./content-store";
import { networkIdle, normalizeCompletion, timeout } from "./completion";
import { createDefaultPathResolver } from "./path-resolver";
import { createDefaultResourceFilter } from "./resource-filter";
import { buildSnapshot } from "./snapshot-builder";
import type {
  CaptureOptions,
  InterceptTarget,
  NetworkEvent,
  PagePocketOptions,
  PageSnapshot
} from "./types";
import { NetworkStore } from "./network-store";

export class PagePocket {
  private target: InterceptTarget;
  private options: PagePocketOptions;

  private constructor(target: InterceptTarget, options?: PagePocketOptions) {
    this.target = target;
    this.options = options ?? {};
  }

  static fromURL(url: string, options?: PagePocketOptions): PagePocket {
    return new PagePocket({ kind: "url", url }, options);
  }

  static fromTarget(target: InterceptTarget, options?: PagePocketOptions): PagePocket {
    return new PagePocket(target, options);
  }

  async capture(options?: CaptureOptions): Promise<PageSnapshot> {
    if (!options?.interceptor) {
      throw new Error("CaptureOptions.interceptor is required.");
    }
    const contentStore = options?.contentStore ?? new HybridContentStore();
    const filter = options?.filter ?? createDefaultResourceFilter();
    const pathResolver = options?.pathResolver ?? createDefaultPathResolver();
    const rewriteEntry = options?.rewriteEntry ?? true;
    const rewriteCSS = options?.rewriteCSS ?? true;
    const limits = options?.limits;

    const completionStrategies = normalizeCompletion(options?.completion);
    const completion =
      completionStrategies.length > 0
        ? completionStrategies
        : [networkIdle(1000), timeout(5000)];

    const store = new NetworkStore({
      contentStore,
      filter,
      limits
    });

    const inflight = new Set<string>();
    let inflightRequests = 0;
    let lastNetworkTs = Date.now();
    let totalRequests = 0;

    const pendingEvents = new Set<Promise<void>>();

    const onEvent = (event: NetworkEvent) => {
      if (event?.timestamp) {
        lastNetworkTs = event.timestamp;
      } else {
        lastNetworkTs = Date.now();
      }
      if (event?.type === "request") {
        totalRequests += 1;
        if (!inflight.has(event.requestId)) {
          inflight.add(event.requestId);
          inflightRequests += 1;
        }
      }
      if (event?.type === "response" || event?.type === "failed") {
        if (inflight.delete(event.requestId)) {
          inflightRequests = Math.max(0, inflightRequests - 1);
        }
      }

      const task = store.handleEvent(event);
      pendingEvents.add(task);
      task.finally(() => pendingEvents.delete(task));
    };

    const session = await options.interceptor.start(this.target, { onEvent });
    if (this.target.kind === "url" && session?.navigate) {
      await session.navigate(this.target.url);
    }

    if (completion.length === 1) {
      await completion[0].wait({
        now: () => Date.now(),
        getStats: () => ({
          inflightRequests,
          lastNetworkTs,
          totalRequests
        })
      });
    } else if (completion.length > 1) {
      await Promise.race(
        completion.map((strategy) =>
          strategy.wait({
            now: () => Date.now(),
            getStats: () => ({
              inflightRequests,
              lastNetworkTs,
              totalRequests
            })
          })
        )
      );
    }

    await session.stop();
    await Promise.all(pendingEvents);

    const entryUrl = this.target.kind === "url" ? this.target.url : "";

    return buildSnapshot({
      entryUrl,
      createdAt: Date.now(),
      resources: store.getResources(),
      apiEntries: store.getApiEntries(),
      contentStore,
      pathResolver,
      rewriteEntry,
      rewriteCSS,
      warnings: store.getWarnings()
    });
  }
}
