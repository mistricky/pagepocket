type ProcessLike = {
  versions?: {
    node?: string;
  };
};

type GlobalWithProcess = {
  process?: ProcessLike;
};

export type UniFetchOptions = {
  maxChallengeRetries?: number;
  userAgent?: string;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isNodeEnvironment(): boolean {
  const globalProcess = (globalThis as GlobalWithProcess).process;
  return typeof globalProcess?.versions?.node === "string";
}

function isServiceWorkerEnvironment(): boolean {
  const hasServiceWorkerGlobal = "ServiceWorkerGlobalScope" in globalThis;
  return (
    typeof self !== "undefined" &&
    typeof window === "undefined" &&
    typeof document === "undefined" &&
    hasServiceWorkerGlobal
  );
}

function isBrowserDomEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getAtob(): (data: string) => string {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob.bind(globalThis);
  }
  const bufferConstructor = (
    globalThis as {
      Buffer?: {
        from(data: string, encoding: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return (data: string) => bufferConstructor.from(data, "base64").toString("binary");
  }
  return (data: string) => data;
}

function getBtoa(): (data: string) => string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa.bind(globalThis);
  }
  const bufferConstructor = (
    globalThis as {
      Buffer?: {
        from(data: string, encoding: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return (data: string) => bufferConstructor.from(data, "binary").toString("base64");
  }
  return (data: string) => data;
}

function captureCookie(cookieStore: Map<string, string>, cookieValue: string): void {
  const [pair] = cookieValue.split(";");
  if (!pair) {
    return;
  }
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    return;
  }
  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  if (!name) {
    return;
  }
  cookieStore.set(name, value);
}

function serializeCookies(cookieStore: Map<string, string>): string {
  return Array.from(cookieStore.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractChallengeCookie(html: string, userAgent: string): string | null {
  if (!html.includes("document.cookie")) {
    return null;
  }

  const cookieStore = new Map<string, string>();
  const atobFn = getAtob();
  const btoaFn = getBtoa();
  const fakeLocation = {
    reload: (): void => {}
  };
  const fakeNavigator = {
    userAgent
  };

  const fakeDocument = {
    location: fakeLocation,
    get cookie(): string {
      return serializeCookies(cookieStore);
    },
    set cookie(value: string) {
      captureCookie(cookieStore, value);
    }
  };

  const fakeWindow = {
    document: fakeDocument,
    location: fakeLocation,
    navigator: fakeNavigator
  };

  const immediateTimer = (callback: () => void): number => {
    callback();
    return 0;
  };

  const scripts = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of scripts) {
    const script = match[1];
    if (!script || !script.includes("document.cookie")) {
      continue;
    }

    try {
      const runner = new Function(
        "document",
        "location",
        "setTimeout",
        "setInterval",
        "navigator",
        "window",
        "self",
        "atob",
        "btoa",
        `"use strict";\n${script}`
      );
      runner(
        fakeDocument,
        fakeLocation,
        immediateTimer,
        immediateTimer,
        fakeNavigator,
        fakeWindow,
        fakeWindow,
        atobFn,
        btoaFn
      );
    } catch {
      continue;
    }
  }

  const cookieHeader = serializeCookies(cookieStore);
  return cookieHeader ? cookieHeader : null;
}

function buildRequestHeaders(request: Request, userAgent: string): Headers {
  const headers = new Headers(request.headers);
  if (!headers.has("user-agent")) {
    headers.set("user-agent", userAgent);
  }
  return headers;
}

async function resolveCloudflareChallenge(
  response: Response,
  userAgent: string
): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return null;
  }
  const html = await response.clone().text();
  return extractChallengeCookie(html, userAgent);
}

async function fetchWithCloudflareBypass(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: UniFetchOptions
): Promise<Response> {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const maxChallengeRetries = options.maxChallengeRetries ?? 1;

  const baseRequest = input instanceof Request ? input : new Request(input, init);
  let headers = buildRequestHeaders(baseRequest, userAgent);
  let response = await fetch(new Request(baseRequest, { headers }));

  for (let attempt = 0; attempt < maxChallengeRetries; attempt += 1) {
    const cookieHeader = await resolveCloudflareChallenge(response, userAgent);
    if (!cookieHeader) {
      break;
    }
    const existingCookie = headers.get("cookie");
    const mergedCookie = [cookieHeader, existingCookie].filter(Boolean).join("; ");
    headers = new Headers(headers);
    headers.set("cookie", mergedCookie);
    response = await fetch(new Request(baseRequest, { headers }));
  }

  return response;
}

export async function uniFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: UniFetchOptions = {}
): Promise<Response> {
  if (isServiceWorkerEnvironment()) {
    throw new Error("TODO: implement service worker fetch behavior.");
  }
  if (isBrowserDomEnvironment()) {
    throw new Error("TODO: implement browser DOM fetch behavior.");
  }
  if (!isNodeEnvironment()) {
    throw new Error("Unsupported environment for uni-fetch.");
  }

  return fetchWithCloudflareBypass(input, init, options);
}
