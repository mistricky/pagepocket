import type { CompletionContext, CompletionStrategy } from "./types";
import { sleep } from "./utils";

export const timeout = (ms: number): CompletionStrategy => ({
  async wait() {
    await sleep(ms);
  }
});

export const networkIdle = (ms: number, checkInterval = 100): CompletionStrategy => ({
  async wait(ctx: CompletionContext) {
    while (true) {
      const stats = ctx.getStats();
      const idleFor = ctx.now() - stats.lastNetworkTs;
      if (stats.inflightRequests === 0 && idleFor >= ms) {
        return;
      }
      await sleep(Math.min(checkInterval, ms));
    }
  }
});

export const normalizeCompletion = (
  completion?: CompletionStrategy | CompletionStrategy[]
): CompletionStrategy[] => {
  if (!completion) return [];
  return Array.isArray(completion) ? completion : [completion];
};
