import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!releaseDirectory) throw new Error("Informe a pasta da release que será verificada.");
const publicKeyPath = path.join(repositoryRoot, "assets", "update-public.pem");
const manifestPath = path.join(releaseDirectory, "release-manifest.json");
const signaturePath = path.join(releaseDirectory, "release-manifest.sig");
const [manifestBytes, signatureText, publicKeyPem] = await Promise.all([
  readFile(manifestPath),
  readFile(signaturePath, "ascii"),
  readFile(publicKeyPath, "utf8")
]);
const publicKey = createPublicKey(publicKeyPem);
const signature = Buffer.from(signatureText.trim(), "base64");
if (publicKey.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, manifestBytes, publicKey, signature)) {
  throw new Error("A assinatura Ed25519 do manifesto é inválida.");
}

const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.application !== "GoLiveBack" || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
  throw new Error("O manifesto de atualização está incompleto.");
}
const names = new Set();
for (const artifact of manifest.artifacts) {
  if (typeof artifact.file !== "string" || path.basename(artifact.file) !== artifact.file || names.has(artifact.file.toLowerCase())) {
    throw new Error("O manifesto contém nomes de artefato inválidos ou duplicados.");
  }
  names.add(artifact.file.toLowerCase());
  const artifactPath = path.join(releaseDirectory, artifact.file);
  const contents = await readFile(artifactPath);
  const metadata = await stat(artifactPath);
  const digest = createHash("sha256").update(contents).digest("hex").toUpperCase();
  if (metadata.size !== artifact.bytes || digest !== String(artifact.sha256).toUpperCase()) {
    throw new Error(`O artefato ${artifact.file} diverge do manifesto assinado.`);
  }
}

const allowedUnlisted = new Set(["release-manifest.json", "release-manifest.sig", "SHA256SUMS.txt"]);
for (const entry of await readdir(releaseDirectory, { withFileTypes: true })) {
  if (entry.isFile() && !allowedUnlisted.has(entry.name) && !names.has(entry.name.toLowerCase())) {
    throw new Error(`A release contém um arquivo não assinado pelo manifesto: ${entry.name}.`);
  }
}
process.stdout.write(`Release segura verificada: ${manifest.version}, ${manifest.artifacts.length} artefato(s).\n`);
