import type { ApiSnapshot, ContentStore, PageSnapshot, PathResolver } from "./types";
import type { ApiEntry, StoredResource } from "./network-store";
import { createDefaultPathResolver, resolveCrossOrigin, withPrefixPathResolver } from "./path-resolver";
import { createPageSnapshot } from "./snapshot";
import { rewriteCssText } from "./css-rewrite";
import { rewriteEntryHtml, rewriteJsText } from "./rewrite-links";
import { decodeUtf8, ensureLeadingSlash, sanitizePosixPath } from "./utils";

type BuildOptions = {
  entryUrl: string;
  createdAt: number;
  resources: StoredResource[];
  apiEntries: ApiEntry[];
  contentStore: ContentStore;
  pathResolver?: PathResolver;
  rewriteEntry: boolean;
  rewriteCSS: boolean;
  warnings: string[];
};

type DocumentGroup = {
  id: string;
  url: string;
  resources: StoredResource[];
  apiEntries: ApiEntry[];
  docResource?: StoredResource;
};

const streamToUint8Array = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value) {
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const docDirFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const clean = sanitizePosixPath(parsed.pathname || "");
    if (!clean) {
      return "root";
    }
    return clean;
  } catch {
    return "root";
  }
};

const groupResources = (input: {
  entryUrl: string;
  resources: StoredResource[];
  apiEntries: ApiEntry[];
  warnings: string[];
}) => {
  const documents = input.resources.filter((resource) => resource.request.resourceType === "document");
  const hasFrameId = input.resources.some((resource) => !!resource.request.frameId);

  const primaryDoc: StoredResource | undefined =
    documents.find((doc) => doc.request.url === input.entryUrl) ?? documents[0];

  if (!hasFrameId) {
    if (documents.length > 1) {
      input.warnings.push("Multiple documents captured without frameId; using the first document.");
    }
    const primaryGroup: DocumentGroup = {
      id: primaryDoc?.request.requestId ?? "root",
      url: primaryDoc?.request.url ?? input.entryUrl,
      resources: [],
      apiEntries: []
    };

    for (const resource of input.resources) {
      if (resource.request.resourceType === "document" && resource !== primaryDoc) {
        continue;
      }
      primaryGroup.resources.push(resource);
      if (resource.request.resourceType === "document") {
        primaryGroup.docResource = resource;
      }
    }

    for (const apiEntry of input.apiEntries) {
      primaryGroup.apiEntries.push(apiEntry);
    }

    return [primaryGroup];
  }

  const groups = new Map<string, DocumentGroup>();
  for (const doc of documents) {
    const id = doc.request.frameId ?? doc.request.requestId;
    groups.set(id, {
      id,
      url: doc.request.url,
      resources: [doc],
      apiEntries: [],
      docResource: doc
    });
  }

  const primaryGroup = primaryDoc
    ? groups.get(primaryDoc.request.frameId ?? primaryDoc.request.requestId) ?? null
    : null;

  const groupByUrl = new Map<string, DocumentGroup>();
  for (const group of groups.values()) {
    groupByUrl.set(group.url, group);
  }

  for (const resource of input.resources) {
    if (resource.request.resourceType === "document") {
      continue;
    }
    const frameId = resource.request.frameId;
    const byFrame = frameId ? groups.get(frameId) : undefined;
    const byInitiator =
      resource.request.initiator?.url ? groupByUrl.get(resource.request.initiator.url) : undefined;
    const target = byFrame ?? byInitiator ?? primaryGroup ?? Array.from(groups.values())[0];
    if (target) {
      target.resources.push(resource);
    }
  }

  for (const entry of input.apiEntries) {
    const frameId = entry.request.frameId;
    const byFrame = frameId ? groups.get(frameId) : undefined;
    const byInitiator =
      entry.request.initiator?.url ? groupByUrl.get(entry.request.initiator.url) : undefined;
    const target = byFrame ?? byInitiator ?? primaryGroup ?? Array.from(groups.values())[0];
    if (target) {
      target.apiEntries.push(entry);
    }
  }

  return Array.from(groups.values());
};

const buildApiSnapshot = (url: string, createdAt: number, entries: ApiEntry[]): ApiSnapshot => ({
  version: "1.0",
  url,
  createdAt,
  records: entries.map((entry) => entry.record)
});

export const buildSnapshot = async (input: BuildOptions): Promise<PageSnapshot> => {
  const warnings = input.warnings;
  const groups = groupResources({
    entryUrl: input.entryUrl,
    resources: input.resources,
    apiEntries: input.apiEntries,
    warnings
  });
  const multiDoc = groups.length > 1;

  const files = [];
  let entryPath = "";
  let title: string | undefined;

  for (const group of groups) {
    const docDir = multiDoc ? docDirFromUrl(group.url) : "";
    const baseResolver = input.pathResolver ?? createDefaultPathResolver();
    const resolver = multiDoc ? withPrefixPathResolver(baseResolver, docDir) : baseResolver;

    const urlToPath = new Map<string, string>();
    for (const resource of group.resources) {
      const path = resolver.resolve({
        url: resource.request.url,
        resourceType: resource.request.resourceType,
        mimeType: resource.mimeType,
        suggestedFilename: undefined,
        isCrossOrigin: resolveCrossOrigin(resource.request.url, group.url),
        entryUrl: group.url
      });
      urlToPath.set(resource.request.url, path);
    }

    const resolve = (absoluteUrl: string) => urlToPath.get(absoluteUrl) ?? null;
    const apiPath = ensureLeadingSlash(
      multiDoc ? `${sanitizePosixPath(docDir)}/api.json` : "/api.json"
    );

    for (const resource of group.resources) {
      if (resource.request.resourceType === "document") {
        const path = urlToPath.get(resource.request.url) ?? "/index.html";
        const stream = await input.contentStore.open(resource.contentRef);
        const bytes = await streamToUint8Array(stream);
        const decoded = decodeUtf8(bytes) ?? "";
        let html = decoded;
        const rewritten = await rewriteEntryHtml({
          html,
          entryUrl: group.url,
          apiPath,
          resolve,
          rewriteLinks: input.rewriteEntry
        });
        html = rewritten.html;
        if (!title) {
          title = rewritten.title;
        }
        const encoded = new TextEncoder().encode(html);
        const contentRef = await input.contentStore.put(
          { kind: "buffer", data: encoded },
          { url: resource.request.url, mimeType: resource.mimeType, sizeHint: encoded.byteLength }
        );
        files.push({
          path,
          mimeType: resource.mimeType ?? "text/html",
          size: encoded.byteLength,
          source: contentRef,
          originalUrl: resource.request.url,
          resourceType: resource.request.resourceType,
          headers: resource.response.headers
        });
        if (resource.request.url === input.entryUrl || !entryPath) {
          entryPath = path;
        }
        continue;
      }

      let contentRef = resource.contentRef;
      let size = resource.size;

      if (resource.request.resourceType === "stylesheet" && input.rewriteCSS) {
        const stream = await input.contentStore.open(resource.contentRef);
        const bytes = await streamToUint8Array(stream);
        const decoded = decodeUtf8(bytes);
        if (decoded !== null) {
          const rewritten = await rewriteCssText({
            cssText: decoded,
            cssUrl: resource.request.url,
            resolveUrl: resolve
          });
          if (rewritten !== decoded) {
            const encoded = new TextEncoder().encode(rewritten);
            contentRef = await input.contentStore.put(
              { kind: "buffer", data: encoded },
              {
                url: resource.request.url,
                mimeType: resource.mimeType,
                sizeHint: encoded.byteLength
              }
            );
            size = encoded.byteLength;
          }
        }
      }

      if (resource.request.resourceType === "script") {
        const stream = await input.contentStore.open(contentRef);
        const bytes = await streamToUint8Array(stream);
        const decoded = decodeUtf8(bytes);
        if (decoded !== null) {
          const rewritten = await rewriteJsText(decoded, resolve, resource.request.url);
          if (rewritten !== decoded) {
            const encoded = new TextEncoder().encode(rewritten);
            contentRef = await input.contentStore.put(
              { kind: "buffer", data: encoded },
              {
                url: resource.request.url,
                mimeType: resource.mimeType,
                sizeHint: encoded.byteLength
              }
            );
            size = encoded.byteLength;
          }
        }
      }

      const path =
        urlToPath.get(resource.request.url) ??
        resolver.resolve({
          url: resource.request.url,
          resourceType: resource.request.resourceType,
          mimeType: resource.mimeType,
          suggestedFilename: undefined,
          isCrossOrigin: resolveCrossOrigin(resource.request.url, group.url),
          entryUrl: group.url
        });
      files.push({
        path,
        mimeType: resource.mimeType,
        size,
        source: contentRef,
        originalUrl: resource.request.url,
        resourceType: resource.request.resourceType,
        headers: resource.response.headers
      });
    }

    const apiSnapshot = buildApiSnapshot(group.url, input.createdAt, group.apiEntries);
    const apiBytes = new TextEncoder().encode(JSON.stringify(apiSnapshot, null, 2));
    const apiRef = await input.contentStore.put(
      { kind: "buffer", data: apiBytes },
      { url: apiPath, mimeType: "application/json", sizeHint: apiBytes.byteLength }
    );
    files.push({
      path: apiPath,
      mimeType: "application/json",
      size: apiBytes.byteLength,
      source: apiRef,
      originalUrl: apiPath
    });
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const totalFiles = files.length;

  const snapshotUrl = input.entryUrl || groups[0]?.url || "";

  return createPageSnapshot({
    version: "1.0",
    createdAt: input.createdAt,
    url: snapshotUrl,
    title,
    entry: entryPath || "/index.html",
    files,
    meta: {
      totalBytes,
      totalFiles,
      warnings: warnings.length ? warnings : undefined
    },
    content: {
      open: (ref) => input.contentStore.open(ref),
      dispose: async () => {
        await input.contentStore.dispose?.();
      }
    }
  });
};
