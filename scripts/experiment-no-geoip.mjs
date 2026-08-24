import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateExit } from "../dist/core/exit-validator.js";
import { startManagedTor } from "../dist/core/managed-tor.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(repositoryRoot, "vendor", "tor");
const requestedRuns = Number.parseInt(process.argv[2] ?? "2", 10);
const runs = Number.isFinite(requestedRuns) ? Math.min(Math.max(requestedRuns, 1), 5) : 2;
const results = [];

for (let run = 1; run <= runs; run += 1) {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "goliveback-no-geoip-"));
  let instance;
  const startedAt = Date.now();
  try {
    instance = await startManagedTor(bundleRoot, stateDirectory, undefined, {
      bootstrapTimeoutMs: 120_000,
      useGeoIpFiles: false
    });
    const validation = await validateExit({ host: "127.0.0.1", port: instance.port });
    results.push({
      run,
      bootstrapMs: Date.now() - startedAt - validation.latencyMs,
      ...validation
    });
  } finally {
    await instance?.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify({ geoIpFiles: false, cleanProfiles: runs, results }, null, 2)}\n`);
