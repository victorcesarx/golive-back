import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(repositoryRoot, "dist");

if (path.dirname(distDirectory) !== repositoryRoot || path.basename(distDirectory) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory");
}

await rm(distDirectory, { recursive: true, force: true });
