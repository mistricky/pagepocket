export type CssUrlResolver = (absoluteUrl: string) => Promise<string | null>;

type RewriteCssInput = {
  filename: string;
  extension: string;
  cssUrl: string;
  resolveUrl: CssUrlResolver;
};

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export const rewriteCssUrls = async (input: RewriteCssInput): Promise<boolean> => {
  const { readText, write } = await import("uni-fs");
  const original = await readText(input.filename, input.extension);
  let updated = "";
  let lastIndex = 0;
  let changed = false;

  for (const match of original.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    updated += original.slice(lastIndex, index);

    const quote = match[1] || "";
    const rawUrl = String(match[2] || "").trim();

    let replacement = match[0];
    if (rawUrl && !rawUrl.startsWith("data:") && !rawUrl.startsWith("blob:")) {
      const absolute = (() => {
        try {
          return new URL(rawUrl, input.cssUrl).toString();
        } catch {
          return null;
        }
      })();

      if (absolute) {
        const resolved = await input.resolveUrl(absolute);
        if (resolved) {
          replacement = `url(${quote}${resolved}${quote})`;
          changed = true;
        }
      }
    }

    updated += replacement;
    lastIndex = index + match[0].length;
  }

  updated += original.slice(lastIndex);

  if (changed) {
    await write(input.filename, input.extension, updated);
  }

  return changed;
};
