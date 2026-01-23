export type CssDependencies = {
  imports: string[];
  urls: string[];
};

export type JsDependencies = {
  imports: string[];
  importScripts: string[];
  fetches: string[];
  xhrs: string[];
};

export function extractCssDependencies(cssText: string): CssDependencies {
  const imports: string[] = [];
  const urls: string[] = [];
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  const importPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?/gi;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(cssText)) !== null) {
    const url = match[2].trim();
    if (url.length > 0) {
      urls.push(url);
    }
  }

  while ((match = importPattern.exec(cssText)) !== null) {
    const url = match[2].trim();
    if (url.length > 0) {
      imports.push(url);
    }
  }

  return { imports, urls };
}

export function extractJsDependencies(jsText: string): JsDependencies {
  const imports = new Set<string>();
  const importScripts = new Set<string>();
  const fetches = new Set<string>();
  const xhrs = new Set<string>();

  const importPattern = /\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importScriptsPattern = /\bimportScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
  const fetchPattern = /\bfetch\(\s*['"]([^'"]+)['"]/g;
  const xhrPattern = /\.open\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(jsText)) !== null) {
    imports.add(match[1]);
  }

  while ((match = dynamicImportPattern.exec(jsText)) !== null) {
    imports.add(match[1]);
  }

  while ((match = importScriptsPattern.exec(jsText)) !== null) {
    importScripts.add(match[1]);
  }

  while ((match = fetchPattern.exec(jsText)) !== null) {
    fetches.add(match[1]);
  }

  while ((match = xhrPattern.exec(jsText)) !== null) {
    xhrs.add(match[1]);
  }

  return {
    imports: [...imports],
    importScripts: [...importScripts],
    fetches: [...fetches],
    xhrs: [...xhrs]
  };
}

export function parseSrcsetUrls(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((url) => url.length > 0);
}

export function shouldInterceptLinkRel(rel: string) {
  const normalized = rel.toLowerCase();
  return (
    normalized.includes("preload") ||
    normalized.includes("prefetch") ||
    normalized.includes("stylesheet") ||
    normalized.includes("icon")
  );
}
