import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(projectRoot, "vendor", "tor");
const manifestPath = path.join(bundleRoot, "BUNDLE-MANIFEST.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (!/^https:\/\/(?:archive|dist)\.torproject\.org\//i.test(manifest.source ?? "")) {
  throw new Error("O bundle Tor não aponta para uma origem oficial HTTPS do Tor Project.");
}
if (!/^[A-F0-9]{64}$/i.test(manifest.sha256 ?? "")) throw new Error("O hash SHA-256 do arquivo-fonte Tor está ausente ou inválido.");
if (!manifest.files || typeof manifest.files !== "object") throw new Error("O manifesto não contém hashes dos arquivos extraídos.");

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (relative !== "BUNDLE-MANIFEST.json") files.push(relative);
  }
  return files;
}

const actualFiles = (await walk(bundleRoot)).sort();
const declaredFiles = Object.keys(manifest.files).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
  const missing = declaredFiles.filter(file => !actualFiles.includes(file));
  const unexpected = actualFiles.filter(file => !declaredFiles.includes(file));
  throw new Error(`Conteúdo do bundle Tor diverge do manifesto. Ausentes: ${missing.join(", ") || "nenhum"}. Inesperados: ${unexpected.join(", ") || "nenhum"}.`);
}

for (const relative of declaredFiles) {
  const contents = await readFile(path.join(bundleRoot, ...relative.split("/")));
  const actual = createHash("sha256").update(contents).digest("hex").toUpperCase();
  const expected = String(manifest.files[relative]).toUpperCase();
  if (actual !== expected) throw new Error(`Integridade inválida no bundle Tor: ${relative}`);
}

console.log(`Bundle Tor ${manifest.bundleVersion} (${manifest.torVersion}) verificado: ${declaredFiles.length} arquivos e origem fixada.`);
