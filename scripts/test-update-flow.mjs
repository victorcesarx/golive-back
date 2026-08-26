import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const currentVersion = String(packageMetadata.version);
const versionMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!versionMatch) throw new Error("A versão atual precisa usar o formato estável major.minor.patch.");

const previousPatch = Number(versionMatch[3]) - 1;
if (previousPatch < 0) throw new Error("Não é possível calcular automaticamente uma versão anterior.");
const simulatedVersion = process.argv[2] ?? `${versionMatch[1]}.${versionMatch[2]}.${previousPatch}`;
if (!/^\d+\.\d+\.\d+$/.test(simulatedVersion)) throw new Error("A versão simulada deve usar major.minor.patch.");

const outputDirectory = path.join(projectRoot, ".tmp", "update-flow");
const profileDirectory = path.join(projectRoot, ".tmp", "update-flow-profile");
const expectedRelativeOutput = path.join(".tmp", "update-flow");
if (path.relative(projectRoot, outputDirectory) !== expectedRelativeOutput) {
  throw new Error("A pasta temporária do teste de atualização é inesperada.");
}
if (path.relative(projectRoot, profileDirectory) !== path.join(".tmp", "update-flow-profile")) {
  throw new Error("A pasta do perfil temporário do teste de atualização é inesperada.");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} encerrou com código ${code}.`)));
  });
}

await rm(outputDirectory, { recursive: true, force: true });
await rm(profileDirectory, { recursive: true, force: true });
await run(process.execPath, [path.join(projectRoot, "scripts", "clean-build.mjs")]);
await run(process.execPath, [path.join(projectRoot, "node_modules", "typescript", "bin", "tsc"), "--project", "tsconfig.json"]);
await run(process.execPath, [
  path.join(projectRoot, "node_modules", "electron-builder", "cli.js"),
  "--dir",
  "--win",
  "--x64",
  "--config.forceCodeSigning=false",
  `--config.extraMetadata.version=${simulatedVersion}`,
  `--config.directories.output=${expectedRelativeOutput}`
]);

const executable = path.join(outputDirectory, "win-unpacked", "GoLiveBack.exe");
await access(executable);
const application = spawn(executable, [`--user-data-dir=${profileDirectory}`], {
  cwd: path.dirname(executable),
  detached: true,
  stdio: "ignore",
  windowsHide: false
});
await new Promise((resolve, reject) => {
  application.once("spawn", resolve);
  application.once("error", reject);
});
application.unref();

process.stdout.write(`Build de teste aberta como versão ${simulatedVersion}.\n`);
process.stdout.write(`Ao clicar em Verificar atualizações, ela deve encontrar a release pública ${currentVersion}.\n`);
process.stdout.write("O instalador baixado ainda pode exibir o SmartScreen porque não possui Authenticode.\n");
