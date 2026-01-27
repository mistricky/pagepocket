import type { NetworkRequestEvent, NetworkResponseEvent, ResourceFilter } from "./types";

const DEFAULT_ALLOWED = new Set([
  "document",
  "stylesheet",
  "script",
  "image",
  "font",
  "media"
]);

const isSkippableUrl = (url: string) =>
  url.startsWith("data:") ||
  url.startsWith("blob:") ||
  url.startsWith("mailto:") ||
  url.startsWith("tel:") ||
  url.startsWith("javascript:");

export const createDefaultResourceFilter = (): ResourceFilter => ({
  shouldSave(req: NetworkRequestEvent, res?: NetworkResponseEvent) {
    if (isSkippableUrl(req.url)) {
      return false;
    }
    if (req.resourceType && (req.resourceType === "fetch" || req.resourceType === "xhr")) {
      return false;
    }
    if (res && res.status >= 400) {
      return false;
    }
    if (req.resourceType) {
      return DEFAULT_ALLOWED.has(req.resourceType);
    }
    return true;
  }
});
