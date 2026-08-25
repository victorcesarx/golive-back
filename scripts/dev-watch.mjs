import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanScript = path.join(projectRoot, "scripts", "clean-dist.mjs");
const typeScriptCompiler = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const electronExecutable = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);

let electronProcess;
let changeTimer;
let buildRunning = false;
let pendingSourceChange = false;
let shuttingDown = false;

function runNode(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { cwd: projectRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Processo de build encerrado com código ${code}.`)));
  });
}

async function compile() {
  await runNode([cleanScript]);
  await runNode([typeScriptCompiler, "--pretty"]);
}

function startElectron() {
  if (shuttingDown) return;
  electronProcess = spawn(electronExecutable, [projectRoot, "--dev-watch"], { cwd: projectRoot, stdio: "inherit" });
  electronProcess.once("error", error => console.error(`[dev] Não foi possível iniciar o Electron: ${error.message}`));
  electronProcess.once("exit", code => {
    electronProcess = undefined;
    if (!shuttingDown) console.log(`[dev] Aplicação fechada${code === null ? "." : ` (código ${code}).`} Salve um arquivo para abri-la novamente.`);
  });
}

async function stopElectron() {
  const child = electronProcess;
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      console.error("[dev] O encerramento coordenado excedeu 20 segundos; finalizando o processo de desenvolvimento.");
      child.kill();
      resolve();
    }, 20_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    const quitRequest = spawn(electronExecutable, [projectRoot, "--dev-restart-request"], {
      cwd: projectRoot,
      stdio: "ignore"
    });
    quitRequest.once("error", error => console.error(`[dev] Não foi possível solicitar o encerramento coordenado: ${error.message}`));
    quitRequest.unref();
  });
}

async function restartElectron() {
  await stopElectron();
  startElectron();
}

async function applyChanges() {
  if (buildRunning || shuttingDown) return;
  buildRunning = true;
  const sourceChanged = pendingSourceChange;
  pendingSourceChange = false;
  try {
    if (sourceChanged) {
      console.log("[dev] Código TypeScript alterado; recompilando…");
      await compile();
    }
    await restartElectron();
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    console.error("[dev] Corrija o erro e salve novamente; a aplicação atual continuará fechada para não executar código antigo.");
  } finally {
    buildRunning = false;
    if (pendingSourceChange) void applyChanges();
  }
}

function scheduleSourceChange() {
  pendingSourceChange = true;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => void applyChanges(), 250);
}

const watchers = [
  watch(path.join(projectRoot, "src"), { recursive: true }, scheduleSourceChange)
];

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(changeTimer);
  for (const watcher of watchers) watcher.close();
  await stopElectron();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log("[dev] Compilando e iniciando o GoLiveBack…");
try {
  await compile();
  startElectron();
  console.log("[dev] Observando src; a interface em public recarrega sem reiniciar a rota. Pressione Ctrl+C para encerrar.");
} catch (error) {
  console.error(`[dev] Falha na compilação inicial: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown();
}
