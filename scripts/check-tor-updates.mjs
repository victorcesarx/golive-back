import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "vendor", "tor", "BUNDLE-MANIFEST.json"), "utf8"));
const response = await fetch("https://aus1.torproject.org/torbrowser/update_3/release/downloads.json", { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`O monitor oficial do Tor respondeu HTTP ${response.status}.`);
const latest = await response.json();
if (typeof latest.version !== "string") throw new Error("O monitor oficial do Tor não retornou uma versão válida.");

if (latest.version !== manifest.bundleVersion) {
  console.error(`Atualização do Tor Expert Bundle disponível: empacotada=${manifest.bundleVersion}, atual=${latest.version}.`);
  process.exitCode = 2;
} else {
  console.log(`Tor Expert Bundle atualizado: ${manifest.bundleVersion}.`);
}
