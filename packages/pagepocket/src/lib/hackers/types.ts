export type HackerStage = "preload" | "replay";

export type HackerContext = {
  stage: HackerStage;
};

export type ScriptHacker = {
  id: string;
  stage: "preload" | "replay";
  build: (context: HackerContext) => string;
};
export type HackerModule = ScriptHacker;
