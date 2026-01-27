export type CssUrlResolver = (absoluteUrl: string) => Promise<string | null> | string | null;

type RewriteCssInput = {
  cssText: string;
  cssUrl: string;
  resolveUrl: CssUrlResolver;
};

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const IMPORT_PATTERN = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?/g;

const shouldSkipValue = (value: string) => {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("#")
  );
};

export const rewriteCssText = async (input: RewriteCssInput): Promise<string> => {
  const { cssText, cssUrl, resolveUrl } = input;
  let updated = "";
  let lastIndex = 0;

  for (const match of cssText.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    updated += cssText.slice(lastIndex, index);
    const quote = match[1] || "";
    const rawUrl = String(match[2] || "").trim();
    let replacement = match[0];
    if (!shouldSkipValue(rawUrl)) {
      const absolute = (() => {
        try {
          return new URL(rawUrl, cssUrl).toString();
        } catch {
          return null;
        }
      })();
      if (absolute) {
        const resolved = await resolveUrl(absolute);
        if (resolved) {
          replacement = `url(${quote}${resolved}${quote})`;
        }
      }
    }
    updated += replacement;
    lastIndex = index + match[0].length;
  }
  updated += cssText.slice(lastIndex);

  let final = "";
  lastIndex = 0;
  for (const match of updated.matchAll(IMPORT_PATTERN)) {
    const index = match.index ?? 0;
    final += updated.slice(lastIndex, index);
    const rawUrl = String(match[1] || "").trim();
    let replacement = match[0];
    if (!shouldSkipValue(rawUrl)) {
      const absolute = (() => {
        try {
          return new URL(rawUrl, cssUrl).toString();
        } catch {
          return null;
        }
      })();
      if (absolute) {
        const resolved = await resolveUrl(absolute);
        if (resolved) {
          replacement = match[0].replace(rawUrl, resolved);
        }
      }
    }
    final += replacement;
    lastIndex = index + match[0].length;
  }
  final += updated.slice(lastIndex);

  return final;
};
