import { readFile, writeFile } from "node:fs/promises";

import { Lighterceptor } from "../src/index";

type Snapshot = {
  url?: string;
  networkRecords?: Array<{ url?: string }>;
  fetchXhrRecords?: Array<{ url?: string }>;
  resources?: Array<{ url?: string }>;
};

const targetUrl = "https://ciechanow.ski/moon/";
const snapshotPath =
  process.env.MOON_SNAPSHOT_PATH ??
  "/home/mist/Repositories/pagepocket/resources/Moon_Bartosz_Ciechanowski.requests.json";
const outputPath =
  process.env.MOON_OUTPUT_PATH ??
  "/home/mist/Repositories/lighterceptor/examples/Moon_Bartosz_Ciechanowski.requests.json";

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function collectSnapshotUrls(snapshot: Snapshot) {
  const urls = new Set<string>();
  const recordGroups = [snapshot.networkRecords, snapshot.fetchXhrRecords, snapshot.resources];

  for (const group of recordGroups) {
    if (!group) {
      continue;
    }
    for (const record of group) {
      if (!record?.url) {
        continue;
      }
      urls.add(normalizeUrl(record.url));
    }
  }

  return urls;
}

async function run() {
  const snapshotRaw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as Snapshot;
  const expectedUrls = collectSnapshotUrls(snapshot);

  const result = await new Lighterceptor(targetUrl, {
    recursion: true
  }).run();
  const actualUrls = new Set(result.requests.map((item) => normalizeUrl(item.url)));

  const intersection = new Set<string>();
  for (const url of actualUrls) {
    if (expectedUrls.has(url)) {
      intersection.add(url);
    }
  }

  const coverage = expectedUrls.size ? intersection.size / expectedUrls.size : 0;
  const missing = [...expectedUrls].filter((url) => !actualUrls.has(url));
  const extra = [...actualUrls].filter((url) => !expectedUrls.has(url));

  console.log("Target URL:", targetUrl);
  console.log("Snapshot:", snapshotPath);
  console.log("Expected URLs:", expectedUrls.size);
  console.log("Captured URLs:", actualUrls.size);
  console.log("Overlap:", intersection.size);
  console.log("Coverage:", `${(coverage * 100).toFixed(2)}%`);
  console.log("Missing sample:", missing.slice(0, 10));
  console.log("Extra sample:", extra.slice(0, 10));

  const networkWithResponse = result.networkRecords?.filter((record) => record.response) ?? [];

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        url: targetUrl,
        title: result.title,
        capturedAt: result.capturedAt,
        networkRecords: networkWithResponse
      },
      null,
      2
    ),
    "utf8"
  );
  console.log("Wrote:", outputPath);
}

void run();
