import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedDirectory = process.argv[2] ?? "release/official";
const releaseDirectory = path.resolve(repositoryRoot, requestedDirectory);
const enforceBudget = process.argv.includes("--enforce");
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const budget = JSON.parse(await readFile(path.join(repositoryRoot, "build-size-budget.json"), "utf8"));

async function sha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size;
  }
  return total;
}

const entries = await readdir(releaseDirectory, { withFileTypes: true });
const executableNames = entries
  .filter(entry => entry.isFile() && /^GoLiveBack-.*\.exe$/i.test(entry.name))
  .map(entry => entry.name)
  .sort();
const artifacts = [];
for (const name of executableNames) {
  const filePath = path.join(releaseDirectory, name);
  const fileStat = await stat(filePath);
  artifacts.push({ file: name, bytes: fileStat.size, sha256: await sha256(filePath) });
}

const unpackedDirectory = path.join(releaseDirectory, "win-unpacked");
const unpackedBytes = entries.some(entry => entry.isDirectory() && entry.name === "win-unpacked")
  ? await directorySize(unpackedDirectory)
  : null;
const metrics = {
  schemaVersion: 1,
  applicationVersion: packageJson.version,
  electronVersion: packageJson.devDependencies.electron,
  architecture: "x64",
  compression: packageJson.build.compression,
  artifacts,
  unpackedBytes,
  budget
};

const failures = [];
const portable = artifacts.find(item => /Portable/i.test(item.file));
const setup = artifacts.find(item => /Setup/i.test(item.file));
if (portable && portable.bytes > budget.portableMaxBytes) failures.push(`portable ${portable.bytes} > ${budget.portableMaxBytes}`);
if (setup && setup.bytes > budget.setupMaxBytes) failures.push(`setup ${setup.bytes} > ${budget.setupMaxBytes}`);
if (unpackedBytes !== null && unpackedBytes > budget.unpackedMaxBytes) failures.push(`unpacked ${unpackedBytes} > ${budget.unpackedMaxBytes}`);

await writeFile(path.join(releaseDirectory, "build-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
if (enforceBudget && failures.length > 0) {
  throw new Error(`Build size budget exceeded: ${failures.join("; ")}`);
}
