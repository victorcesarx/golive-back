import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!releaseDirectory) throw new Error("Informe a pasta que contém release-manifest.json.");

const privateKeyPath = path.resolve(
  process.env.GOLIVEBACK_UPDATE_PRIVATE_KEY ?? path.join(os.homedir(), ".goliveback-signing", "update-private.pem")
);
const relativeKeyPath = path.relative(repositoryRoot, privateKeyPath);
if (!relativeKeyPath.startsWith("..") && !path.isAbsolute(relativeKeyPath)) {
  throw new Error("A chave privada de atualização deve permanecer fora do repositório.");
}

const manifestPath = path.join(releaseDirectory, "release-manifest.json");
const signaturePath = path.join(releaseDirectory, "release-manifest.sig");
const [manifest, privateKeyPem] = await Promise.all([readFile(manifestPath), readFile(privateKeyPath, "utf8")]);
const privateKey = createPrivateKey(privateKeyPem);
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("A chave de atualização deve ser Ed25519.");
const signature = sign(null, manifest, privateKey).toString("base64");
await writeFile(signaturePath, `${signature}\n`, { encoding: "ascii", flag: "wx" });
process.stdout.write(`Manifesto de atualização assinado: ${signaturePath}\n`);
