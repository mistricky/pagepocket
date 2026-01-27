import type { PageSnapshot } from "./types";
import { toZip, writeToFS } from "./writers";

export const createPageSnapshot = (data: Omit<PageSnapshot, "toDirectory" | "toZip">): PageSnapshot => {
  return {
    ...data,
    toDirectory: (outDir, options) => writeToFS(data as PageSnapshot, outDir, options),
    toZip: (options) => toZip(data as PageSnapshot, options)
  };
};
