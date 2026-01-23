import type { ResourceKind } from "./lighterceptor-model.js";

export function resolveUrl(baseUrl: string | undefined, url: string) {
  if (!url) {
    return undefined;
  }
  if (baseUrl) {
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return url;
    }
  }

  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

export function parseAbsoluteUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isSkippableUrl(url: string) {
  const lowered = url.toLowerCase();
  return (
    lowered.startsWith("data:") || lowered.startsWith("javascript:") || lowered.startsWith("about:")
  );
}

export function inferResourceKindFromUrl(url: string) {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const extension = cleanUrl.split(".").pop()?.toLowerCase();
  if (!extension) {
    return undefined;
  }
  if (extension === "html" || extension === "htm") {
    return "html";
  }
  if (extension === "css") {
    return "css";
  }
  if (extension === "js" || extension === "mjs" || extension === "cjs") {
    return "js";
  }
  return undefined;
}

export function detectResourceKind(url: string, contentType: string | undefined, text: string) {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("text/html")) {
    return "html";
  }
  if (normalized.includes("text/css")) {
    return "css";
  }
  if (normalized.includes("javascript")) {
    return "js";
  }

  const inferred = inferResourceKindFromUrl(url);
  if (inferred) {
    return inferred;
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return "html";
  }
  if (trimmed.startsWith("<")) {
    return "html";
  }
  if (trimmed.startsWith("@") || trimmed.includes("url(")) {
    return "css";
  }
  if (looksLikeJavaScript(trimmed)) {
    return "js";
  }
  return undefined;
}

export function detectInputKind(input: string): ResourceKind {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("<")) {
    return "html";
  }
  if (trimmed.startsWith("@") || trimmed.includes("url(")) {
    return "css";
  }
  return "js";
}

export function looksLikeJavaScript(text: string) {
  return (
    /\b(import|export)\b/.test(text) ||
    /\b(const|let|var|function)\b/.test(text) ||
    /\bfetch\s*\(/.test(text) ||
    /\bXMLHttpRequest\b/.test(text) ||
    /\bimportScripts\s*\(/.test(text)
  );
}

export function inferKindFromElement(element: unknown): ResourceKind | undefined {
  if (!element || typeof element !== "object") {
    return undefined;
  }

  const tagName =
    "tagName" in element && typeof element.tagName === "string"
      ? element.tagName.toLowerCase()
      : "";

  if (tagName === "script") {
    return "js";
  }
  if (tagName === "iframe") {
    return "html";
  }
  if (tagName === "link" && "getAttribute" in element) {
    const rel = String((element as Element).getAttribute("rel") ?? "").toLowerCase();
    const asValue = String((element as Element).getAttribute("as") ?? "").toLowerCase();

    if (rel.includes("stylesheet")) {
      return "css";
    }
    if (rel.includes("preload") || rel.includes("prefetch")) {
      if (asValue === "style") {
        return "css";
      }
      if (asValue === "script") {
        return "js";
      }
    }
  }

  return undefined;
}

export function resolveBodyEncoding(contentType: string | undefined) {
  if (!contentType) {
    return "text";
  }
  const normalized = contentType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("svg")
  ) {
    return "text";
  }
  return "base64";
}

export function decodeText(buffer: Buffer, contentType: string | undefined, fallback: string) {
  const charset = contentType
    ?.toLowerCase()
    .match(/charset=([^;]+)/)?.[1]
    ?.trim();
  if (!charset) {
    return fallback;
  }
  try {
    const decoder = new TextDecoder(charset);
    return decoder.decode(buffer);
  } catch {
    return fallback;
  }
}
