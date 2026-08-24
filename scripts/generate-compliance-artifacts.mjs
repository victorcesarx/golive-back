import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandArguments = process.argv.slice(2).filter(argument => argument !== "--");
const outputDirectory = path.resolve(projectRoot, commandArguments.find(argument => !argument.startsWith("--")) ?? "release/compliance");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const torManifest = JSON.parse(await readFile(path.join(projectRoot, "vendor", "tor", "BUNDLE-MANIFEST.json"), "utf8"));
const command = process.platform === "win32"
  ? { executable: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "pnpm licenses list --json"] }
  : { executable: "pnpm", args: ["licenses", "list", "--json"] };
const licenseOutput = execFileSync(command.executable, command.args, {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024
});
const licenseGroups = JSON.parse(licenseOutput);
const packages = new Map();

for (const [licenseExpression, entries] of Object.entries(licenseGroups)) {
  for (const entry of entries) {
    for (const version of entry.versions ?? []) {
      const key = `${entry.name}@${version}`;
      packages.set(key, {
        name: entry.name,
        version,
        license: entry.license ?? licenseExpression,
        ...(entry.homepage ? { homepage: entry.homepage } : {})
      });
    }
  }
}

const sortedPackages = [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
const torComponent = {
  type: "application",
  name: "tor",
  version: torManifest.torVersion,
  scope: "required",
  purl: `pkg:generic/tor@${encodeURIComponent(torManifest.torVersion)}`,
  licenses: [{ expression: "BSD-3-Clause" }],
  externalReferences: [{ type: "distribution", url: torManifest.source }]
};
const components = sortedPackages.map(entry => ({
  type: "library",
  name: entry.name,
  version: entry.version,
  scope: entry.name === "electron" && entry.version === packageJson.devDependencies.electron ? "required" : "optional",
  purl: `pkg:npm/${entry.name.startsWith("@") ? entry.name.replace("/", "%2F") : entry.name}@${encodeURIComponent(entry.version)}`,
  licenses: [{ expression: entry.license }],
  ...(entry.homepage ? { externalReferences: [{ type: "website", url: entry.homepage }] } : {})
}));
components.push(torComponent);

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      "bom-ref": `pkg:npm/${packageJson.name}@${packageJson.version}`,
      name: "GoLiveBack",
      version: packageJson.version,
      purl: `pkg:npm/${packageJson.name}@${packageJson.version}`
    }
  },
  components
};
const licenseReport = {
  application: "GoLiveBack",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  packageCount: sortedPackages.length,
  packages: sortedPackages,
  bundledComponents: [
    { name: "Electron", version: packageJson.devDependencies.electron, notice: "LICENSES.chromium.html and LICENSE.electron.txt are included in the packaged runtime." },
    { name: "Tor Expert Bundle", version: torManifest.bundleVersion, torVersion: torManifest.torVersion, notice: "License notices are preserved under vendor/tor/docs and THIRD_PARTY_NOTICES.md." }
  ]
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "bom.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "THIRD-PARTY-LICENSES.json"), `${JSON.stringify(licenseReport, null, 2)}\n`, "utf8");
console.log(`SBOM CycloneDX e relatório de ${sortedPackages.length} pacotes gravados em ${outputDirectory}.`);
