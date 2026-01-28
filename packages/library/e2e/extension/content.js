const SAVE_DIR = "pagepocket-moon";
const SAVE_REQUEST = "PAGEPOCKET_SAVE";
const SAVE_DONE = "PAGEPOCKET_SAVE_DONE";
const SAVE_FAILED = "PAGEPOCKET_SAVE_FAILED";

let isSaving = false;

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || data.type !== SAVE_REQUEST) {
    return;
  }

  if (isSaving) {
    window.postMessage({ type: SAVE_FAILED, error: "save-in-progress" }, "*");
    return;
  }

  isSaving = true;
  savePage()
    .then((manifest) => {
      window.postMessage({ type: SAVE_DONE, manifest }, "*");
    })
    .catch((error) => {
      window.postMessage({ type: SAVE_FAILED, error: String(error) }, "*");
    })
    .finally(() => {
      isSaving = false;
    });
});

async function savePage() {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(SAVE_DIR, { create: true });
  await clearDirectory(dir);

  const pageUrl = window.location.href;
  const html = document.documentElement ? document.documentElement.outerHTML : "";
  await writeTextFile(dir, "index.html", html);

  const resources = collectResources();
  const savedAssets = [];

  for (const resourceUrl of resources) {
    try {
      const response = await fetch(resourceUrl, { credentials: "include" });
      if (!response.ok) {
        continue;
      }
      const buffer = await response.arrayBuffer();
      const path = await assetPathFor(resourceUrl);
      await writeFile(dir, path, buffer);
      savedAssets.push({ url: resourceUrl, path, size: buffer.byteLength });
    } catch {
      // Ignore failed assets to keep the save resilient.
    }
  }

  const manifest = {
    url: pageUrl,
    savedAt: new Date().toISOString(),
    assets: savedAssets
  };

  await writeTextFile(dir, "manifest.json", JSON.stringify(manifest, null, 2));
  return manifest;
}

function collectResources() {
  const urls = new Set();
  const selectors = [
    ["img", "src"],
    ["script", "src"],
    ['link[rel="stylesheet"]', "href"],
    ['link[rel="icon"]', "href"],
    ["source", "src"],
    ["video", "src"],
    ["audio", "src"]
  ];

  for (const [selector, attr] of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      const value = node.getAttribute(attr);
      if (!value) {
        return;
      }
      const absolute = toAbsoluteUrl(value);
      if (!absolute) {
        return;
      }
      urls.add(absolute);
    });
  }

  return Array.from(urls);
}

function toAbsoluteUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function assetPathFor(resourceUrl) {
  const url = new URL(resourceUrl);
  const filename = url.pathname.split("/").filter(Boolean).pop() || "index";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = await shortHash(resourceUrl);
  return `assets/${safeName}_${hash}`;
}

async function shortHash(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function clearDirectory(dir) {
  for await (const [name] of dir.entries()) {
    await dir.removeEntry(name, { recursive: true });
  }
}

async function writeTextFile(dir, path, text) {
  const data = new TextEncoder().encode(text);
  await writeFile(dir, path, data);
}

async function writeFile(dir, path, data) {
  const parts = path.split("/").filter(Boolean);
  let current = dir;

  for (let i = 0; i < parts.length - 1; i += 1) {
    current = await current.getDirectoryHandle(parts[i], { create: true });
  }

  const fileHandle = await current.getFileHandle(parts[parts.length - 1], {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}
