import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectories = [
  path.join(repositoryRoot, "dist"),
  path.join(repositoryRoot, ".tmp", "test-dist")
];

for (const outputDirectory of outputDirectories) {
  const relative = path.relative(repositoryRoot, outputDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !["dist", path.join(".tmp", "test-dist")].includes(relative)) {
    throw new Error("Refusing to clean an unexpected build directory");
  }
  await rm(outputDirectory, { recursive: true, force: true });
}
