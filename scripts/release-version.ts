import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const run = (command: string) => {
  execSync(command, { stdio: "inherit" });
};

const findPackageJsons = async (rootDir: string) => {
  const results: string[] = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findPackageJsons(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name === "package.json") {
      results.push(entryPath);
    }
  }
  return results;
};

const updatePackageVersion = async (packageJsonPath: string, version: string) => {
  const content = await fs.readFile(packageJsonPath, { encoding: "utf8" });
  const data = JSON.parse(content) as { version?: string };
  data.version = version;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(packageJsonPath, serialized, "utf-8");
};

const main = async () => {
  const inputVersion = process.argv[2];
  if (!inputVersion) {
    throw new Error("Missing version argument (expected format: vX.Y.Z).");
  }
  if (!inputVersion.startsWith("v") || inputVersion.length < 2) {
    throw new Error(`Version must include a v prefix (got: ${inputVersion}).`);
  }

  const normalizedVersion = inputVersion.slice(1);
  const repoRoot = process.cwd();

  const rootPackageJson = path.join(repoRoot, "package.json");
  const packageJsons = await findPackageJsons(path.join(repoRoot, "packages"));
  const allPackageJsons = [rootPackageJson, ...packageJsons];

  for (const packageJsonPath of allPackageJsons) {
    await updatePackageVersion(packageJsonPath, normalizedVersion);
  }

  const filesToStage = allPackageJsons.map((filePath) => path.relative(repoRoot, filePath));
  run(`git add ${filesToStage.map((file) => `"${file}"`).join(" ")}`);
  run(`git commit -m "[Release] ${inputVersion}"`);
  run(`git tag ${inputVersion}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
