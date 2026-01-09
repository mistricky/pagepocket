import { run } from "@oclif/core";

run().catch((error) => {
  const message = error && typeof error.message === "string" ? error.message : String(error);
  console.error(message);
  const exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
  process.exit(exitCode);
});
