import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: projectRoot, encoding: "utf8", windowsHide: true })
  .split("\0")
  .filter(Boolean);
const forbiddenNames = /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:p12|pfx|pvk|pem|key))$/i;
const patterns = [
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained token", expression: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "AWS access key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "Slack token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "Google API key", expression: /\bAIza[0-9A-Za-z_-]{35}\b/ }
];
const findings = [];

for (const relative of tracked) {
  const normalized = relative.replaceAll("\\", "/");
  if (forbiddenNames.test(normalized)) {
    findings.push(`${normalized}: arquivo sensível versionado`);
    continue;
  }
  const absolute = path.join(projectRoot, relative);
  let contents;
  try {
    const buffer = await readFile(absolute);
    if (buffer.length > 2 * 1024 * 1024 || buffer.includes(0)) continue;
    contents = buffer.toString("utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    if (pattern.expression.test(contents)) findings.push(`${normalized}: possível ${pattern.name}`);
  }
}

if (findings.length > 0) throw new Error(`Possíveis segredos encontrados:\n${findings.join("\n")}`);
console.log(`Verificação de segredos concluída em ${tracked.length} arquivos versionados.`);
