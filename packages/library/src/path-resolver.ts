import type { PathResolver, ResourceType } from "./types";
import { hashString, sanitizePosixPath } from "./utils";

const normalizePathname = (pathname: string) => {
  const normalized = pathname || "/";
  const clean = sanitizePosixPath(normalized);
  const leading = clean ? `/${clean}` : "/";
  if (leading.endsWith("/")) {
    return `${leading}index`;
  }
  return leading;
};

const withSuffix = (path: string, suffix: string) => {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot > lastSlash) {
    return `${path.slice(0, lastDot)}${suffix}${path.slice(lastDot)}`;
  }
  return `${path}${suffix}`;
};

const sameDomain = (left: URL, right: URL) => left.hostname === right.hostname;

export const createDefaultPathResolver = (): PathResolver => {
  const resolvedByUrl = new Map<string, string>();
  const usedPaths = new Map<string, string>();

  return {
    resolve(input) {
      if (resolvedByUrl.has(input.url)) {
        return resolvedByUrl.get(input.url) ?? "/index.html";
      }

      if (input.resourceType === "document") {
        const entryPath = "/index.html";
        resolvedByUrl.set(input.url, entryPath);
        return entryPath;
      }

      let parsed: URL | null = null;
      try {
        parsed = new URL(input.url);
      } catch {
        parsed = null;
      }

      const pathname = normalizePathname(parsed?.pathname || "/");
      const queryHash = `${parsed?.search || ""}${parsed?.hash || ""}`;
      const suffix = queryHash ? `__ppq_${hashString(queryHash)}` : "";

      const basePath = input.isCrossOrigin ? `/external_resources${pathname}` : `${pathname}`;
      let resolvedPath = suffix ? withSuffix(basePath, suffix) : basePath;

      const collisionKey = resolvedPath;
      const existingUrl = usedPaths.get(collisionKey);
      if (existingUrl && existingUrl !== input.url) {
        const collisionSuffix = `__ppc_${hashString(input.url)}`;
        resolvedPath = withSuffix(resolvedPath, collisionSuffix);
      }

      usedPaths.set(resolvedPath, input.url);
      resolvedByUrl.set(input.url, resolvedPath);
      return resolvedPath;
    }
  };
};

export const resolveCrossOrigin = (url: string, entryUrl: string) => {
  try {
    const parsed = new URL(url);
    const entry = new URL(entryUrl);
    return !sameDomain(parsed, entry);
  } catch {
    return false;
  }
};

export const withPrefixPathResolver = (resolver: PathResolver, prefix: string): PathResolver => {
  const normalizedPrefix = sanitizePosixPath(prefix);
  if (!normalizedPrefix) {
    return resolver;
  }
  const prefixWithSlash = `/${normalizedPrefix}`;
  return {
    resolve(input) {
      const resolved = resolver.resolve(input);
      if (!resolved.startsWith("/")) {
        return `${prefixWithSlash}/${resolved}`;
      }
      return `${prefixWithSlash}${resolved}`;
    }
  };
};

export const isDocumentType = (resourceType?: ResourceType) => resourceType === "document";
