import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!destination) throw new Error("Informe uma pasta privada fora do repositório para armazenar a chave de atualização.");

const relativeToRepository = path.relative(repositoryRoot, destination);
if (!relativeToRepository.startsWith("..") && !path.isAbsolute(relativeToRepository)) {
  throw new Error("A chave privada de atualização não pode ser armazenada dentro do repositório.");
}

await mkdir(destination, { recursive: true, mode: 0o700 });
const privateKeyPath = path.join(destination, "update-private.pem");
const publicKeyPath = path.join(destination, "update-public.pem");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
await writeFile(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { flag: "wx", mode: 0o644 });

process.stdout.write(`Chave privada criada em ${privateKeyPath}\n`);
process.stdout.write(`Chave pública criada em ${publicKeyPath}\n`);
