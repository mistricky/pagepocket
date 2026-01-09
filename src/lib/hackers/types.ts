import type { Page } from "puppeteer";
import type { NetworkRecord } from "../types";

export type HackerStage = "capture" | "preload" | "replay";

export type HackerContext = {
  stage: HackerStage;
};

export type ScriptHacker = {
  id: string;
  stage: "preload" | "replay";
  build: (context: HackerContext) => string;
};

export type CaptureContext = {
  stage: "capture";
  page: Page;
  networkRecords: NetworkRecord[];
};

export type CaptureHacker = {
  id: string;
  stage: "capture";
  apply: (context: CaptureContext) => void | Promise<void>;
};

export type HackerModule = ScriptHacker | CaptureHacker;
