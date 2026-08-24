import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, session, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { discoverDiscord, inspectDiscordExecutable, type DiscordInstallation } from "./core/discord.js";
import { startPacServer, type PacServer } from "./core/pac.js";
import { startGatewayRouter, type GatewayRouter } from "./core/gateway-router.js";
import {
  clearSocksProxyCredentials,
  connectViaSocks5,
  hasSocksProxyCredentials,
  parseSocksProxy,
  requiresRemoteSocksCredentialWarning,
  type SocksProxy
} from "./core/upstream-socks.js";
import { findTorExit, validateExit, type ExitValidation } from "./core/exit-validator.js";
import { isDiscordRunning, launchDiscord, stopDiscord } from "./core/discord-launcher.js";
import { AppLogger } from "./core/logger.js";
import { PreferenceStore } from "./core/preferences.js";
import { startManagedTor, type ManagedTorInstance } from "./core/managed-tor.js";
import { HealthMonitor } from "./core/health-monitor.js";
import { resolveValidatedStartupCommand } from "./core/startup.js";
import { redactSensitiveText } from "./core/sensitive-data.js";
import { ShutdownCoordinator, type ShutdownReason } from "./core/shutdown-coordinator.js";
import { inspectWindowsExecutable } from "./core/windows-executable.js";
import { checkProjectUpdate, PROJECT_LATEST_RELEASE_URL } from "./core/update-checker.js";
import {
  isTrustedIpcSender,
  isTrustedRendererUrl,
  navigationTargetForLog,
  resolveUiResource,
  UI_CONTENT_SECURITY_POLICY,
  UI_ENTRY_URL,
  UI_SCHEME
} from "./core/ui-security.js";

protocol.registerSchemesAsPrivileged([{
  scheme: UI_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    codeCache: true
  }
}]);

let pacServer: PacServer | undefined;
let gatewayRouter: GatewayRouter | undefined;
let activeProxy: SocksProxy | undefined;
interface ProxyReference { current: SocksProxy | undefined }
let activeProxyReference: ProxyReference | undefined;
let activeValidation: ExitValidation | undefined;
let mainWindow: BrowserWindow | undefined;
let logger: AppLogger | undefined;
let monitoredDiscord: DiscordInstallation | undefined;
let monitorTimer: NodeJS.Timeout | undefined;
let preferences: PreferenceStore | undefined;
let tray: Tray | undefined;
let quitting = false;
let managedTor: ManagedTorInstance | undefined;
let stoppingManagedTor: ManagedTorInstance | undefined;
let healthMonitor: HealthMonitor | undefined;
let routeRecovery: Promise<boolean> | undefined;
let routeStopPromise: Promise<void> | undefined;
let allowQuitAfterCleanup = false;
let quitRequestPromise: Promise<void> | undefined;
const pendingRouteOperations = new Set<Promise<unknown>>();

const shutdownCoordinator = new ShutdownCoordinator(
  async reason => {
    quitting = true;
    logger?.info(`Encerramento coordenado iniciado (${reason}).`);
    healthMonitor?.stop();
    healthMonitor = undefined;
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = undefined;
    const pending = [...pendingRouteOperations];
    if (pending.length > 0) {
      logger?.info(`Aguardando ${pending.length} operação(ões) de rota cancelar(em) com segurança.`);
      await Promise.allSettled(pending);
    }
    try {
      await stopRoute(true, false);
      logger?.info("PAC, roteador local e Tor integrado foram encerrados.");
    } catch (error) {
      logger?.error(`O encerramento coordenado encontrou uma falha: ${errorMessage(error)}`);
    }
  },
  () => {
    const tor = managedTor ?? stoppingManagedTor;
    if (tor?.forceStop()) logger?.info(`Fallback de encerramento aplicado somente ao Tor integrado criado pelo GoLiveBack (PID ${tor.pid}).`);
  }
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", showWindow);

type AppPhase = "idle" | "validating" | "ready" | "discord-running" | "recovering" | "error";
type TrayStatusKind = "idle" | "ready" | "busy" | "error";

// Native menu labels render colored-circle emoji with a platform-specific glossy style.
// These embedded PNGs use the same solid semantic colors as the status dot in the app.
const TRAY_STATUS_ICON_DATA: Record<TrayStatusKind, string> = {
  idle: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACoSURBVDhPYxgF+EF9/XyO5u7pDiBc398vABUmDjR3Talo7Zr6vbVr2n8Ybuuc3g4yFKoEN2jtnNqArBEFd06bD1WGHdR3TZFAtxkD90zSgCrHBEDbA7BqQsItHdMKoMoxQUvXlARsmpAxKHygyjEByHnZNCFjUKxAlWMHLV1Tl2PTCMFTj0OV4QagOAeG9nZsmtvbpytAlREGIKeCoxSCA6DCgwowMAAA0+i/Byg3aiQAAAAASUVORK5CYII=",
  ready: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACuSURBVDhPYxgF+IH9/noO4+PtDiCsf75eACpMHDA93lphcrL9u+nJ9v8wbHKqvR1kKFQJbgBU3ICsERmbnGqbD1WGHZie7JJAtxkdGx9t1YAqxwRmJ1oDsGlCxiYn2gqgyjGB6fH2BGyaUDAwfKDKMQHIeVg1IWFQrECVYwdARcvRNcGwycm241BluAEozk1OtG/Hptn8eLsCVBlhAHIqUCMoShtAgQsVHlSAgQEAXN+1G/TO0ckAAAAASUVORK5CYII=",
  busy: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACnSURBVDhPYxgF+MH//fYc77d7O4Dxfn8BqDBx4MM2r4oP272/f9jh/R+GP+70bgcZClWCGwBtbEDWiIbnQ5VhB1+2eEmg24yOP+3w0YAqxwTvd3gGYNOEjN/v8C6AKscE77d7JWDThIKB4QNVjglAzsOqCQmDYgWqHDv4uMNrOTaNUHwcqgw3AMX5x+3e27Fpfr/dXQGqjDCAJqIGMAYGLlR4UAEGBgD9WtdtPhNfPwAAAABJRU5ErkJggg==",
  error: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACpSURBVDhPYxgF+MH9+HiO59HpDiD8Pj5fACpMHHgemVHxIjLj+4uojP8InN4OMhSqBDd4HpnegKoRCUdmzIcqww5ehmZJYNqMip9GpmlAlWOCF5GZAdg0oeCIjAKockzwPCo9AasmJAwKH6hyTAByHjZNyBgUK1Dl2AEwtJdj0wjCwAA+DlWGG4DiHKh4OzbNz8PTFaDKCANwIgJGKThagYELFR5UgIEBAPn4wLa9I+54AAAAAElFTkSuQmCC"
};
const trayStatusIconCache = new Map<TrayStatusKind, ReturnType<typeof nativeImage.createFromDataURL>>();

interface RuntimeStatus {
  phase: AppPhase;
  message: string;
  detail?: string;
  updatedAt: string;
}
let runtimeStatus: RuntimeStatus = {
  phase: "idle",
  message: "Nenhuma rota ativa.",
  detail: "Ative o GoLive para criar uma rota",
  updatedAt: new Date().toISOString()
};
let routeActivationStartedAt: number | undefined;
let routeStartupDurationMs: number | undefined;

function setStatus(phase: AppPhase, message: string, detail?: string) {
  runtimeStatus = { phase, message, ...(detail ? { detail } : {}), updatedAt: new Date().toISOString() };
  logger?.info(`Status da aplicação: ${message}${detail ? ` — ${detail}` : ""}`);
  mainWindow?.webContents.send("status:update", runtimeStatus);
  updateTrayMenu();
}

function beginRouteTiming() {
  routeActivationStartedAt = Date.now();
}

function completeRouteTiming() {
  routeStartupDurationMs = Math.max(0, Date.now() - (routeActivationStartedAt ?? Date.now()));
  routeActivationStartedAt = undefined;
}

function routeTimingDetail() {
  return `Iniciada em ${routeStartupDurationMs ?? 0} ms`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function trackRouteOperation<T>(operation: () => Promise<T>): Promise<T> {
  const promise = Promise.resolve().then(operation);
  pendingRouteOperations.add(promise);
  const remove = () => pendingRouteOperations.delete(promise);
  void promise.then(remove, remove);
  return promise;
}

function assertTrustedIpcEvent(event: IpcMainInvokeEvent, channel: string) {
  const expectedContents = mainWindow?.webContents;
  const trusted = Boolean(expectedContents && isTrustedIpcSender({
    senderId: event.sender.id,
    expectedSenderId: expectedContents.id,
    frameUrl: event.senderFrame?.url ?? null,
    isMainFrame: event.senderFrame === expectedContents.mainFrame
  }));
  if (trusted) return;
  logger?.error(`Uma chamada IPC não confiável foi recusada no canal ${channel}.`);
  throw new Error("A origem desta solicitação não é confiável.");
}

function handleTrustedIpc(channel: string, handler: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcEvent(event, channel);
    return handler(...args);
  });
}

function configureSessionSecurity() {
  const applicationSession = session.defaultSession;
  const loggedPermissions = new Set<string>();
  applicationSession.setPermissionCheckHandler(() => false);
  applicationSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (!loggedPermissions.has(permission)) {
      loggedPermissions.add(permission);
      logger?.info(`Uma permissão web não utilizada foi recusada: ${permission}.`);
    }
    callback(false);
  });
  applicationSession.setDevicePermissionHandler(() => false);
  applicationSession.on("will-download", event => {
    event.preventDefault();
    logger?.info("Uma tentativa inesperada de download pela interface foi bloqueada.");
  });
}

function registerUiProtocol() {
  let blockedResourceWasLogged = false;
  protocol.handle(UI_SCHEME, async request => {
    if (request.method !== "GET") {
      return new Response("Método não permitido", {
        status: 405,
        headers: { allow: "GET", "content-type": "text/plain; charset=utf-8" }
      });
    }
    const resource = resolveUiResource(request.url, app.getAppPath());
    if (!resource) {
      if (!blockedResourceWasLogged) {
        blockedResourceWasLogged = true;
        logger?.info(`Um recurso fora da allowlist da interface foi recusado: ${navigationTargetForLog(request.url)}.`);
      }
      return new Response("Não encontrado", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    try {
      const content = await readFile(resource.filePath);
      const headers: Record<string, string> = {
        "content-type": resource.contentType,
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff"
      };
      if (request.url === UI_ENTRY_URL) headers["content-security-policy"] = UI_CONTENT_SECURITY_POLICY;
      return new Response(content, { status: 200, headers });
    } catch (error) {
      logger?.error(`Um recurso permitido da interface não pôde ser carregado: ${errorMessage(error)}`);
      return new Response("Não encontrado", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
  });
}

function proxyFailureMessage(error: unknown, proxy?: SocksProxy) {
  const message = errorMessage(error);
  if (/Invalid URL|URI malformed/i.test(message)) return "O endereço está incompleto ou contém caracteres inválidos. Use socks5://servidor:porta.";
  if (/Only socks5/i.test(message)) return "Somente proxies SOCKS5 são aceitas. Comece o endereço com socks5://.";
  if (/Invalid SOCKS5 proxy address/i.test(message)) return "O servidor ou a porta da proxy SOCKS5 é inválido.";
  if (/username and password must both/i.test(message)) return "Informe usuário e senha juntos, ou remova os dois campos da proxy.";
  if (/credentials are too long/i.test(message)) return "O usuário ou a senha informados são longos demais.";
  if (/connection timed out|ETIMEDOUT/i.test(message)) return "A proxy não respondeu dentro do tempo esperado.";
  if (/ECONNREFUSED/i.test(message)) return "A conexão foi recusada pelo servidor da proxy.";
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return "O endereço do servidor da proxy não foi encontrado.";
  if (/requires credentials/i.test(message)) return "A proxy exige usuário e senha.";
  if (/rejected credentials/i.test(message)) return "A proxy recusou o usuário ou a senha informados.";
  if (/rejected authentication methods|Unsupported SOCKS5 authentication/i.test(message)) return "O método de autenticação desta proxy não é compatível.";
  if (/excluded country BR/i.test(message)) return "A proxy possui saída no Brasil e não pode ser usada para esta rota.";
  if (/Discord gateway did not return/i.test(message)) return "A proxy não conseguiu acessar o gateway do Discord.";
  if (/Discord (?:WebSocket|gateway).*(?:handshake|closed|rejected)/i.test(message)) return "A proxy não conseguiu abrir o canal em tempo real do Discord.";
  if (/TLS handshake|TLS certificate/i.test(message)) return "Não foi possível estabelecer uma conexão segura por esta proxy.";
  if (/Cloudflare trace/i.test(message)) return "Não foi possível identificar com segurança a localização de saída da proxy.";
  return redactSensitiveText(message, [proxy?.username, proxy?.password]);
}

function proxyErrorForLog(error: unknown, proxy?: SocksProxy) {
  return redactSensitiveText(proxyFailureMessage(error, proxy), [proxy?.host, proxy?.username, proxy?.password]);
}

function safeProxy(proxy: SocksProxy | undefined) {
  if (!proxy) return null;
  return `socks5://${hasSocksProxyCredentials(proxy) ? "***:***@" : ""}${proxy.host}:${proxy.port}`;
}

function replaceActiveProxy(nextProxy: SocksProxy) {
  const previousProxy = activeProxy;
  activeProxy = nextProxy;
  if (activeProxyReference) activeProxyReference.current = nextProxy;
  if (previousProxy !== nextProxy) clearSocksProxyCredentials(previousProxy);
}

async function confirmRemoteProxyCredentials(proxy: SocksProxy) {
  if (!requiresRemoteSocksCredentialWarning(proxy)) return true;
  const result = await dialog.showMessageBox(mainWindow!, {
    type: "warning",
    title: "Credenciais em proxy remota",
    message: "SOCKS5 envia usuário e senha sem criptografia própria até o servidor da proxy.",
    detail: [
      "Em uma rede monitorada, essas credenciais podem ser observadas antes de a conexão chegar à proxy.",
      "Prefira uma proxy local ou um túnel protegido, como SSH ou VPN, e continue apenas se confiar na rede e no servidor.",
      "A senha e o token do Discord não são enviados à proxy. O tráfego do Discord continua protegido por TLS depois do túnel.",
      "A rota atual permanecerá ativa até a nova proxy ser validada por completo."
    ].join("\n\n"),
    buttons: ["Continuar mesmo assim", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return result.response === 0;
}

async function stopRoute(stopTor = true, announce = true) {
  if (routeStopPromise) return routeStopPromise;
  const operation = performStopRoute(stopTor, announce);
  routeStopPromise = operation;
  try {
    await operation;
  } finally {
    if (routeStopPromise === operation) routeStopPromise = undefined;
  }
}

async function performStopRoute(stopTor: boolean, announce: boolean) {
  if (pacServer || gatewayRouter || activeProxy || (stopTor && managedTor)) {
    logger?.info(announce ? "Desativando a rota e encerrando os serviços locais." : "Substituindo os serviços locais da rota.");
  }
  healthMonitor?.stop();
  healthMonitor = undefined;
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = undefined;
  monitoredDiscord = undefined;
  const pac = pacServer;
  const router = gatewayRouter;
  const proxy = activeProxy;
  const proxyReference = activeProxyReference;
  pacServer = undefined;
  gatewayRouter = undefined;
  activeProxy = undefined;
  activeProxyReference = undefined;
  activeValidation = undefined;
  const tor = stopTor ? managedTor : undefined;
  if (stopTor) {
    managedTor = undefined;
    stoppingManagedTor = tor;
  }
  const failures: unknown[] = [];
  const localServices: Promise<unknown>[] = [];
  if (pac) localServices.push(Promise.resolve().then(() => pac.close()));
  if (router) localServices.push(Promise.resolve().then(() => router.close()));
  const localResults = await Promise.allSettled(localServices);
  for (const result of localResults) if (result.status === "rejected") failures.push(result.reason);
  if (tor) {
    const torResult = await Promise.allSettled([Promise.resolve().then(() => tor.stop())]);
    if (torResult[0]?.status === "rejected") {
      failures.push(torResult[0].reason);
      managedTor = tor;
    }
    if (stoppingManagedTor === tor) stoppingManagedTor = undefined;
  }
  clearSocksProxyCredentials(proxy);
  if (proxyReference?.current && proxyReference.current !== proxy) {
    clearSocksProxyCredentials(proxyReference.current);
  }
  if (proxyReference) proxyReference.current = undefined;
  mainWindow?.webContents.send("security:clear-sensitive-fields");
  if (announce) {
    routeActivationStartedAt = undefined;
    routeStartupDurationMs = undefined;
    setStatus("idle", "Rota desativada.", "Ative o GoLive para criar uma rota");
  }
  if (failures.length > 0) throw new AggregateError(failures, "Um ou mais serviços locais não encerraram corretamente");
}

function requestApplicationQuit(reason: Exclude<ShutdownReason, "windows-session">) {
  if (quitRequestPromise) return quitRequestPromise;
  quitting = true;
  updateTrayMenu();
  quitRequestPromise = (async () => {
    await shutdownCoordinator.request(reason);
    allowQuitAfterCleanup = true;
    app.quit();
  })();
  return quitRequestPromise;
}

function beginWindowsSessionShutdown() {
  quitting = true;
  void shutdownCoordinator.request("windows-session").catch(error => {
    logger?.error(`O encerramento solicitado pelo Windows encontrou uma falha: ${errorMessage(error)}`);
  });
}

function forceWindowsSessionShutdown() {
  quitting = true;
  shutdownCoordinator.force("windows-session");
}

function managedTorBundleRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "tor") : path.join(app.getAppPath(), "vendor", "tor");
}

function startupCommand() {
  return resolveValidatedStartupCommand({
    ...(process.env.PORTABLE_EXECUTABLE_FILE ? { portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE } : {}),
    processExecutable: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged
  }, inspectWindowsExecutable);
}

async function setStartWithWindows(enabled: boolean) {
  if (process.platform !== "win32") throw new Error("Automatic startup is Windows-only in this MVP");
  if (!enabled) {
    app.setLoginItemSettings({ openAtLogin: false });
    await preferences?.update({ startWithWindows: false });
    logger?.info("Inicialização automática desativada e entrada anterior removida do Windows.");
    updateTrayMenu();
    return { success: true, enabled: false };
  }
  const command = await startupCommand();
  app.setLoginItemSettings({
    openAtLogin: true,
    path: command.executable,
    args: command.args
  });
  await preferences?.update({ startWithWindows: true });
  logger?.info(`Inicialização automática ativada com launcher validado. Executável: ${command.executable}`);
  updateTrayMenu();
  return { success: true, enabled: true };
}

async function reconcileStartWithWindows() {
  if (process.platform !== "win32" || !app.isPackaged || !preferences?.get().startWithWindows) return;
  try {
    const command = await startupCommand();
    app.setLoginItemSettings({ openAtLogin: true, path: command.executable, args: command.args });
    logger?.info(`Entrada de inicialização automática revisada para o launcher atual: ${command.executable}`);
  } catch (error) {
    app.setLoginItemSettings({ openAtLogin: false });
    await preferences.update({ startWithWindows: false });
    logger?.error(`A entrada de inicialização automática foi removida porque o launcher não pôde ser validado: ${errorMessage(error)}`);
  }
}

async function bootManagedTor() {
  shutdownCoordinator.assertRunning();
  const bundleRoot = managedTorBundleRoot();
  const noGeoIpExperiment = await readFile(path.join(bundleRoot, "NO-GEOIP-EXPERIMENT"), "utf8")
    .then(() => true)
    .catch(() => false);
  if (noGeoIpExperiment) logger?.info("Build experimental identificada: Tor será iniciado sem bancos GeoIP locais.");
  const instance = await startManagedTor(bundleRoot, path.join(app.getPath("userData"), "tor-data"), line => {
    const progress = /Bootstrapped (\d+)%/.exec(line)?.[1];
    if (progress && !shutdownCoordinator.isStopping) setStatus("validating", `Tor conectando: ${progress}%`);
    logger?.info(`Detalhe do Tor: ${line}`);
  }, { signal: shutdownCoordinator.signal, useGeoIpFiles: !noGeoIpExperiment });
  try {
    shutdownCoordinator.assertRunning();
    managedTor = instance;
    return { host: "127.0.0.1", port: instance.port } satisfies SocksProxy;
  } catch (error) {
    await instance.stop();
    throw error;
  }
}

async function activateRoute(proxyValue: unknown) {
  shutdownCoordinator.assertRunning();
  if (typeof proxyValue !== "string" || proxyValue.length > 2_048) throw new Error("O endereço informado para a proxy é inválido.");
  if (runtimeStatus.phase === "validating" || runtimeStatus.phase === "recovering") throw new Error("Aguarde a operação atual da rota terminar antes de analisar outra proxy.");
  const previousStatus = runtimeStatus;
  const previousRoute = { pacServer, gatewayRouter, activeProxy };
  const hadActiveRoute = Boolean(previousRoute.pacServer && previousRoute.gatewayRouter && previousRoute.activeProxy);
  let candidateProxy: SocksProxy | undefined;
  let analysisStarted = false;
  try {
    candidateProxy = parseSocksProxy(proxyValue.trim());
    if (!await confirmRemoteProxyCredentials(candidateProxy)) {
      logger?.info("O uso de credenciais em uma proxy remota foi cancelado. A rota não foi alterada.");
      return { success: false, canceled: true, routePreserved: hadActiveRoute };
    }
    shutdownCoordinator.assertRunning();
    analysisStarted = true;
    beginRouteTiming();
    logger?.info(`Análise de proxy personalizada iniciada. ${hadActiveRoute ? "A rota atual será preservada até a nova rota estar pronta." : "Nenhuma rota atual será alterada durante a análise."}`);
    setStatus("validating", "Analisando nova proxy…", hadActiveRoute ? "A rota atual permanece ativa" : "Verificando conexão e localização");
    const validation = await validateExit(candidateProxy);
    shutdownCoordinator.assertRunning();
    logger?.info(`A proxy personalizada foi validada. Saída: ${validation.country} (${validation.ip}). Preparando a substituição da rota.`);
    const result = await installRoute(candidateProxy, validation);
    await (preferences?.update({ routeMode: "manual" }) ?? Promise.resolve()).catch(error => {
      logger?.error(`A nova rota está ativa, mas a preferência do modo manual não pôde ser salva: ${errorMessage(error)}`);
    });
    return result;
  } catch (error) {
    routeActivationStartedAt = undefined;
    const currentRouteWasPreserved = pacServer === previousRoute.pacServer
      && gatewayRouter === previousRoute.gatewayRouter
      && activeProxy === previousRoute.activeProxy;
    const reason = proxyFailureMessage(error, candidateProxy);
    logger?.error(`A proxy personalizada não foi aplicada: ${proxyErrorForLog(error, candidateProxy)}. ${currentRouteWasPreserved && hadActiveRoute ? "A rota anterior continua ativa." : "Nenhuma rota foi alterada."}`);
    if (analysisStarted && !shutdownCoordinator.isStopping) setStatus(previousStatus.phase, previousStatus.message, previousStatus.detail);
    throw new Error(`A proxy não foi aplicada. ${hadActiveRoute && currentRouteWasPreserved ? "A rota atual continua ativa. " : ""}Motivo: ${reason}`);
  } finally {
    if (candidateProxy && activeProxy !== candidateProxy) clearSocksProxyCredentials(candidateProxy);
    proxyValue = undefined;
  }
}

async function activateTorRoute() {
  shutdownCoordinator.assertRunning();
  beginRouteTiming();
  logger?.info("Ativação do GoLive solicitada. Procurando uma saída Tor válida.");
  setStatus("validating", "Procurando saída Tor…");
  try {
    let found;
    try {
      found = await findTorExit();
      shutdownCoordinator.assertRunning();
      logger?.info(`Uma instalação do Tor já disponível foi encontrada na porta ${found.proxy.port}.`);
    } catch {
      shutdownCoordinator.assertRunning();
      setStatus("validating", "Iniciando Tor integrado…");
      await stopRoute(true, false);
      const proxy = await bootManagedTor();
      found = { proxy, validation: await validateExit(proxy) };
      shutdownCoordinator.assertRunning();
      logger?.info(`O Tor integrado ficou pronto na porta ${proxy.port}.`);
    }
    shutdownCoordinator.assertRunning();
    await preferences?.update({ routeMode: "tor" });
    shutdownCoordinator.assertRunning();
    return await installRoute(found.proxy, found.validation, managedTor !== undefined && found.proxy.port === managedTor.port);
  } catch (error) {
    routeActivationStartedAt = undefined;
    logger?.error(`Não foi possível preparar uma saída Tor válida: ${errorMessage(error)}`);
    if (!shutdownCoordinator.isStopping) setStatus("error", "Falha ao ativar o GoLive.");
    throw error;
  }
}

async function installRoute(proxy: SocksProxy, validation: ExitValidation, preserveManagedTor = false) {
  shutdownCoordinator.assertRunning();
  // Prepare the complete replacement before touching the live route. Capturing the candidate
  // reference also lets recovery replace its Tor circuit later without changing the local PAC.
  const candidateProxyReference: ProxyReference = { current: proxy };
  const router = await startGatewayRouter((host, port) => {
    const currentProxy = candidateProxyReference.current;
    if (!currentProxy) throw new Error("A rota da proxy foi encerrada.");
    return connectViaSocks5(currentProxy, host, port);
  });
  let pac: PacServer | undefined;
  try {
    shutdownCoordinator.assertRunning();
    pac = await startPacServer(router.port);
    shutdownCoordinator.assertRunning();
  } catch (error) {
    const candidates: Promise<unknown>[] = [router.close()];
    if (pac) candidates.push(pac.close());
    await Promise.allSettled(candidates);
    candidateProxyReference.current = undefined;
    throw error;
  }
  if (!pac) throw new Error("O servidor PAC não foi iniciado.");

  const previousPac = pacServer;
  const previousRouter = gatewayRouter;
  const previousProxy = activeProxy;
  const previousProxyReference = activeProxyReference;
  const previousTor = preserveManagedTor ? undefined : managedTor;
  healthMonitor?.stop();
  healthMonitor = undefined;
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = undefined;
  monitoredDiscord = undefined;

  gatewayRouter = router;
  pacServer = pac;
  activeProxy = proxy;
  activeProxyReference = candidateProxyReference;
  activeValidation = validation;
  if (!preserveManagedTor) managedTor = undefined;

  const obsoleteResources: Promise<unknown>[] = [];
  if (previousPac && previousPac !== pac) obsoleteResources.push(previousPac.close());
  if (previousRouter && previousRouter !== router) obsoleteResources.push(previousRouter.close());
  if (previousTor) obsoleteResources.push(previousTor.stop());
  const closeResults = await Promise.allSettled(obsoleteResources);
  for (const result of closeResults) {
    if (result.status === "rejected") logger?.error(`A nova rota está ativa, mas um serviço anterior não encerrou corretamente: ${errorMessage(result.reason)}`);
  }
  if (previousProxy !== proxy) clearSocksProxyCredentials(previousProxy);
  if (previousProxyReference?.current && previousProxyReference.current !== proxy && previousProxyReference.current !== previousProxy) {
    clearSocksProxyCredentials(previousProxyReference.current);
  }
  if (previousProxyReference && previousProxyReference !== candidateProxyReference) previousProxyReference.current = undefined;

  shutdownCoordinator.assertRunning();
  completeRouteTiming();
  logger?.info("A nova rota foi preparada e substituiu a rota anterior com segurança.");
  setStatus("ready", "Rota ativa. Reinicie o Discord", routeTimingDetail());
  startHealthMonitor();
  return { success: true, pacUrl: pac.url, proxy: safeProxy(proxy), exit: validation };
}

function startHealthMonitor() {
  healthMonitor?.stop();
  if (shutdownCoordinator.isStopping) {
    healthMonitor = undefined;
    return;
  }
  healthMonitor = new HealthMonitor(
    async () => {
      if (!activeProxy) throw new Error("No active proxy");
      activeValidation = await validateExit(activeProxy);
    },
    (failures, error) => logger?.error(`A verificação de saúde da rota falhou (${failures}/2): ${proxyErrorForLog(error, activeProxy)}`),
    async () => { await trackRouteOperation(recoverRoute); },
    { intervalMs: 60_000, failureThreshold: 2 }
  );
  healthMonitor.start();
}

async function recoverRoute(): Promise<boolean> {
  if (shutdownCoordinator.isStopping) return false;
  if (routeRecovery) return routeRecovery;
  routeRecovery = performRouteRecovery();
  try {
    return await routeRecovery;
  } finally {
    routeRecovery = undefined;
  }
}

async function performRouteRecovery(): Promise<boolean> {
  shutdownCoordinator.assertRunning();
  if (!activeProxy) return false;
  beginRouteTiming();
  logger?.info("A rota perdeu a validação. Iniciando recuperação automática.");
  setStatus("recovering", "Recuperando rota…");
  try {
    if (preferences?.get().routeMode === "tor") {
      try {
        const found = await findTorExit();
        shutdownCoordinator.assertRunning();
        replaceActiveProxy(found.proxy);
        activeValidation = found.validation;
      } catch {
        shutdownCoordinator.assertRunning();
        await managedTor?.stop();
        managedTor = undefined;
        const replacementProxy = await bootManagedTor();
        replaceActiveProxy(replacementProxy);
        activeValidation = await validateExit(replacementProxy);
        shutdownCoordinator.assertRunning();
      }
    } else {
      activeValidation = await validateExit(activeProxy);
      shutdownCoordinator.assertRunning();
    }
    completeRouteTiming();
    const discordRunning = monitoredDiscord ? await isDiscordRunning(monitoredDiscord).catch(() => false) : false;
    setStatus(discordRunning ? "discord-running" : "ready", discordRunning ? "Rota ativa" : "Rota ativa. Reinicie o Discord", routeTimingDetail());
    return true;
  } catch (error) {
    routeActivationStartedAt = undefined;
    logger?.error(`A recuperação automática da rota falhou: ${proxyErrorForLog(error, activeProxy)}`);
    if (!shutdownCoordinator.isStopping) setStatus("error", "Rota indisponível.", "O Discord não será reiniciado");
    return false;
  }
}

async function ensureHealthyRouteBeforeRestart() {
  shutdownCoordinator.assertRunning();
  if (!activeProxy) throw new Error("A rota não está ativa.");
  const previousStatus = runtimeStatus;
  const proxyBeingChecked = activeProxy;
  logger?.info("Verificando a rota e o WebSocket do Discord antes de encerrar o cliente atual.");
  setStatus("validating", "Verificando rota…", "O Discord permanecerá aberto");
  try {
    activeValidation = await validateExit(proxyBeingChecked);
    shutdownCoordinator.assertRunning();
    setStatus(previousStatus.phase, previousStatus.message, previousStatus.detail);
    logger?.info("A rota respondeu ao handshake WebSocket do Discord. O reinício pode continuar.");
  } catch (error) {
    if (shutdownCoordinator.isStopping) throw error;
    logger?.error(`A verificação anterior ao reinício falhou: ${proxyErrorForLog(error, proxyBeingChecked)}. O Discord atual será mantido aberto enquanto a rota é recuperada.`);
    const recovered = await recoverRoute();
    if (!recovered) {
      throw new Error("A rota não respondeu e não pôde ser recuperada. O Discord foi mantido aberto para evitar a tela de carregamento infinito.");
    }
    logger?.info("A rota foi recuperada e validada antes do reinício do Discord.");
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 380,
    height: 500,
    minWidth: 380,
    minHeight: 500,
    maxWidth: 380,
    maxHeight: 500,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: "GoLiveBack",
    icon: path.join(app.getAppPath(), "assets", "app-icon.png"),
    webPreferences: {
      // Sandboxed preload scripts run as CommonJS in Electron. Keeping this file as .cjs
      // prevents the package-level ESM mode from disabling the context bridge.
      preload: path.join(app.getAppPath(), "public", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => {
    logger?.info("Uma tentativa inesperada de abrir outra janela foi bloqueada.");
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (isTrustedRendererUrl(navigationUrl)) return;
    event.preventDefault();
    logger?.info(`Uma navegação inesperada foi bloqueada: ${navigationTargetForLog(navigationUrl)}.`);
  });
  window.webContents.on("will-redirect", (event, navigationUrl) => {
    event.preventDefault();
    logger?.info(`Um redirecionamento inesperado foi bloqueado: ${navigationTargetForLog(navigationUrl)}.`);
  });
  window.webContents.on("will-attach-webview", event => {
    event.preventDefault();
    logger?.info("Uma tentativa inesperada de anexar um webview foi bloqueada.");
  });
  window.webContents.on("did-finish-load", () => {
    logger?.info(`A interface local segura foi carregada em ${UI_ENTRY_URL}.`);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    logger?.error(`A interface local não pôde ser carregada (${errorCode}): ${errorDescription}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logger?.error(`O processo isolado da interface foi encerrado: ${details.reason}.`);
  });
  window.on("enter-full-screen", () => window.setFullScreen(false));
  window.on("query-session-end", beginWindowsSessionShutdown);
  window.on("session-end", forceWindowsSessionShutdown);
  window.on("hide", () => window.webContents.send("security:clear-sensitive-fields"));
  window.on("minimize", () => window.webContents.send("security:clear-sensitive-fields"));
  window.on("close", event => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => { mainWindow = undefined; });
  await window.loadURL(UI_ENTRY_URL);
}

function showWindow() {
  if (shutdownCoordinator.isStopping) return;
  mainWindow?.show();
  mainWindow?.focus();
}

function trayStatusIcon(phase: AppPhase) {
  const kind: TrayStatusKind = phase === "ready" || phase === "discord-running" ? "ready"
    : phase === "validating" || phase === "recovering" ? "busy"
      : phase === "error" ? "error" : "idle";
  const cached = trayStatusIconCache.get(kind);
  if (cached) return cached;
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_STATUS_ICON_DATA[kind]}`);
  trayStatusIconCache.set(kind, icon);
  return icon;
}

function updateTrayMenu() {
  if (!tray) return;
  const selectedPreferences = preferences?.get();
  const selectedExecutable = selectedPreferences?.discordExecutable;
  const selectedLabel = selectedPreferences?.channel === "stable" ? "Discord"
    : selectedPreferences?.channel === "ptb" ? "Discord PTB"
      : selectedPreferences?.channel === "canary" ? "Discord Canary"
        : selectedExecutable ? path.parse(selectedExecutable).name : "não selecionado";
  const routeActive = Boolean(activeProxy && pacServer && gatewayRouter);
  const routeBusy = runtimeStatus.phase === "validating" || runtimeStatus.phase === "recovering";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir GoLiveBack", click: showWindow },
    { label: runtimeStatus.message, icon: trayStatusIcon(runtimeStatus.phase), enabled: false },
    { type: "separator" },
    { label: `Build: ${selectedLabel}`, enabled: false },
    {
      label: routeActive ? "Desativar Rota" : "Ativar Rota",
      enabled: !routeBusy && !shutdownCoordinator.isStopping,
      click: () => {
        const action = routeActive ? stopRoute() : trackRouteOperation(activateGoLive);
        void action.catch(error => {
          logger?.error(`A ação solicitada pela bandeja falhou: ${errorMessage(error)}`);
          setStatus("error", routeActive ? "Falha ao desativar a rota." : "Falha ao ativar o GoLive.");
        });
      }
    },
    { type: "separator" },
    { label: "Sair", enabled: !shutdownCoordinator.isStopping, click: () => { void requestApplicationQuit("tray"); } }
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), "assets", "tray-icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("GoLiveBack");
  tray.on("double-click", showWindow);
  updateTrayMenu();
}

function discordLabel(installation: DiscordInstallation) {
  return installation.channel === "custom" ? path.parse(installation.executable).name : installation.channel === "stable" ? "Discord" : `Discord ${installation.channel.toUpperCase()}`;
}

async function availableDiscordInstallations() {
  const discovered = await discoverDiscord();
  const configured = preferences?.get().discordExecutable;
  let configuredInstallation: DiscordInstallation | undefined;
  if (configured) {
    const executable = path.resolve(configured);
    try {
      await access(executable);
      const parent = path.basename(path.dirname(executable));
      configuredInstallation = {
        channel: preferences?.get().channel ?? "custom",
        version: /^app-(\d+(?:\.\d+)+)$/i.exec(parent)?.[1] ?? "manual",
        executable,
        root: path.dirname(executable)
      };
    } catch {
      logger?.info("A instalação do Discord salva não está mais disponível e foi ignorada na listagem.");
    }
  }
  const candidates = [...(configuredInstallation ? [configuredInstallation] : []), ...discovered];
  const installations: DiscordInstallation[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.executable.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Listing is intentionally metadata-only. Manual selection and every restart
    // still validate Authenticode immediately before any executable is trusted,
    // stopped or launched. This keeps opening the UI independent from PowerShell.
    installations.push(candidate);
  }
  return installations;
}

async function confirmCompatibleDiscord(installation: DiscordInstallation) {
  if (!installation.requiresConfirmation) return true;
  const result = await dialog.showMessageBox(mainWindow!, {
    type: "warning",
    title: "Confirmar distribuição do Discord",
    message: "Esta distribuição não foi assinada pela Discord Inc.",
    detail: [
      `Aplicação: ${installation.productName ?? discordLabel(installation)}`,
      `Publicador: ${installation.publisher ?? "não identificado"}`,
      `Executável: ${installation.executable}`,
      "O GoLiveBack encerrará e abrirá somente este executável. Continue apenas se você reconhece e confia nesta distribuição."
    ].join("\n"),
    buttons: ["Usar esta distribuição", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return result.response === 0;
}

async function persistDiscordInstallation(installation: DiscordInstallation) {
  await preferences?.update({ channel: installation.channel, discordExecutable: installation.executable });
  logger?.info(`Aplicação selecionada e validada: ${discordLabel(installation)}. Executável: ${installation.executable}. Confiança: ${installation.trust ?? "desconhecida"}.`);
  updateTrayMenu();
  return installation;
}

async function selectDiscordExecutable(executable: unknown): Promise<DiscordInstallation | null> {
  if (typeof executable !== "string" || executable.length > 32_767) throw new Error("Caminho inválido para o Discord");
  const installation = await inspectDiscordExecutable(executable);
  if (!await confirmCompatibleDiscord(installation)) return null;
  return persistDiscordInstallation(installation);
}

async function detectDiscordInstallations() {
  const installations = await availableDiscordInstallations();
  const configured = preferences?.get().discordExecutable;
  let selected = configured ? installations.find(item => item.executable.toLowerCase() === configured.toLowerCase()) : undefined;
  selected ??= installations.find(item => item.channel === preferences?.get().channel) ?? installations[0];
  if (selected && selected.executable !== configured) {
    await preferences?.update({ channel: selected.channel, discordExecutable: selected.executable });
    updateTrayMenu();
  }
  return { installations, selected: selected ?? null };
}

async function chooseDiscordExecutable() {
  const configured = preferences?.get().discordExecutable;
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Selecionar instalação do Discord",
    ...(configured ? { defaultPath: path.dirname(configured) } : {}),
    properties: ["openFile", "dontAddToRecent"],
    filters: [{ name: "Aplicativos Windows", extensions: ["exe"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, installation: null };
  const installation = await selectDiscordExecutable(result.filePaths[0]);
  return installation ? { canceled: false, installation } : { canceled: true, installation: null };
}

async function launchDiscordInstallation(installation: DiscordInstallation) {
  shutdownCoordinator.assertRunning();
  if (!pacServer || !gatewayRouter || !activeProxy) throw new Error("Activate and validate a route before opening Discord");
  // Revalidate immediately before launch to prevent a selected file from being
  // replaced after it was stored in preferences.
  const validated = await inspectDiscordExecutable(installation.executable);
  shutdownCoordinator.assertRunning();
  const pid = await launchDiscord(validated, pacServer.url);
  const label = discordLabel(validated);
  logger?.info(`${label} ${validated.version} foi iniciado com a rota ativa. Processo: ${pid ?? "desconhecido"}.`);
  setStatus("discord-running", "Rota ativa", routeTimingDetail());
  startProcessMonitor(validated);
  return { success: true, installation: validated, pid, pacUrl: pacServer.url };
}

async function activateGoLive() {
  shutdownCoordinator.assertRunning();
  if (runtimeStatus.phase === "validating" || runtimeStatus.phase === "recovering") {
    throw new Error("A rota ainda está sendo preparada");
  }
  if (activeProxy && pacServer && gatewayRouter && activeValidation && (runtimeStatus.phase === "ready" || runtimeStatus.phase === "discord-running")) {
    return { success: true, alreadyActive: true, pacUrl: pacServer.url, proxy: safeProxy(activeProxy), exit: activeValidation };
  }
  if (activeProxy || pacServer || gatewayRouter) await stopRoute();
  return activateTorRoute();
}

async function restartRunningDiscord() {
  shutdownCoordinator.assertRunning();
  if (!pacServer || !gatewayRouter || !activeProxy) throw new Error("Ative o GoLive antes de reiniciar o Discord.");
  const installations = await availableDiscordInstallations();
  let running: DiscordInstallation | undefined;
  for (const installation of installations) {
    shutdownCoordinator.assertRunning();
    if (await isDiscordRunning(installation)) {
      running = installation;
      break;
    }
  }
  if (!running) throw new Error("Nenhuma instância do Discord está aberta. Abra o Discord manualmente e tente novamente.");
  // Validate again immediately before stopping anything. A tampered or replaced
  // executable must never be allowed to drive process termination.
  running = await inspectDiscordExecutable(running.executable);
  shutdownCoordinator.assertRunning();
  let discordWasStopped = false;
  try {
    await ensureHealthyRouteBeforeRestart();
    shutdownCoordinator.assertRunning();
    logger?.info(`${discordLabel(running)} está aberto. Encerrando a aplicação para reaplicar a rota.`);
    await stopDiscord(running);
    discordWasStopped = true;
    await preferences?.update({ channel: running.channel, discordExecutable: running.executable });
    return await launchDiscordInstallation(running);
  } catch (error) {
    if (discordWasStopped) setStatus("ready", "Rota ativa. Reinicie o Discord", routeTimingDetail());
    throw error;
  }
}

function startProcessMonitor(installation: DiscordInstallation) {
  monitoredDiscord = installation;
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = setInterval(async () => {
    if (!monitoredDiscord || shutdownCoordinator.isStopping) return;
    try {
      const running = await isDiscordRunning(monitoredDiscord);
      // Do not overwrite validation/recovery progress or a meaningful error with the
      // ordinary process state. Once the route is ready, the next poll promotes it.
      if (running && (runtimeStatus.phase === "ready" || runtimeStatus.phase === "idle")) {
        setStatus("discord-running", "Rota ativa", routeTimingDetail());
      } else if (!running && runtimeStatus.phase === "discord-running") {
        setStatus(activeProxy ? "ready" : "idle", activeProxy ? "Rota ativa. Reinicie o Discord" : "Discord fechado.", activeProxy ? routeTimingDetail() : "Ative o GoLive para criar uma rota");
      }
    } catch (error) {
      logger?.error(`Não foi possível verificar se o Discord continua aberto: ${errorMessage(error)}`);
    }
  // Path-aware detection invokes the native Windows process inspector. Five
  // seconds keeps status responsive without spawning an inspector every 2 seconds.
  }, 5_000);
  monitorTimer.unref();
}

app.whenReady().then(async () => {
  app.setAppUserModelId("app.goliveback.desktop");
  logger = new AppLogger(app.getPath("userData"));
  preferences = new PreferenceStore(app.getPath("userData"));
  await preferences.load();
  logger.info(`GoLiveBack ${app.getVersion()} iniciado. Os registros desta sessão serão gravados neste arquivo.`);
  await reconcileStartWithWindows();
  configureSessionSecurity();
  registerUiProtocol();
  handleTrustedIpc("app:status", () => runtimeStatus);
  handleTrustedIpc("app:open-log", async () => {
    if (!logger) throw new Error("O arquivo de log ainda não está disponível.");
    await logger.tail();
    const directory = path.dirname(logger.file);
    const openError = await shell.openPath(directory);
    if (openError) throw new Error(openError);
    logger.info(`A pasta de logs foi aberta. Arquivo atual: ${logger.file}`);
    return { success: true, directory, file: logger.file };
  });
  handleTrustedIpc("app:check-update", async () => {
    const currentVersion = app.getVersion();
    logger?.info(`Verificando se o GoLiveBack ${currentVersion} é a release mais recente.`);
    try {
      const result = await checkProjectUpdate(currentVersion);
      if (result.updateAvailable) {
        logger?.info(`Uma atualização está disponível: ${result.latestVersion}. Abrindo a página oficial de releases.`);
        await shell.openExternal(PROJECT_LATEST_RELEASE_URL);
      } else {
        logger?.info(`O GoLiveBack está atualizado na versão ${currentVersion}.`);
      }
      return result;
    } catch (error) {
      logger?.error(`A verificação de atualização falhou: ${errorMessage(error)}`);
      throw error;
    }
  });
  handleTrustedIpc("preferences:get", () => preferences?.get());
  handleTrustedIpc("discord:detect", detectDiscordInstallations);
  handleTrustedIpc("discord:select", async (executable: unknown) => {
    const installation = await selectDiscordExecutable(executable);
    if (!installation) throw new Error("A seleção da distribuição foi cancelada.");
    return installation;
  });
  handleTrustedIpc("discord:choose", chooseDiscordExecutable);
  handleTrustedIpc("preferences:set-start-with-windows", async (enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid automatic startup value");
    return setStartWithWindows(enabled);
  });
  handleTrustedIpc("app:activate-golive", () => trackRouteOperation(activateGoLive));
  handleTrustedIpc("discord:restart", () => trackRouteOperation(restartRunningDiscord));
  handleTrustedIpc("window:minimize", () => mainWindow?.minimize());
  handleTrustedIpc("window:close", () => mainWindow?.close());
  handleTrustedIpc("route:activate", (proxy: unknown) => trackRouteOperation(() => activateRoute(proxy)));
  handleTrustedIpc("route:deactivate", async () => {
    await stopRoute();
    return { success: true };
  });
  await createWindow();
  createTray();
  if (process.argv.includes("--hidden")) {
    mainWindow?.hide();
    void trackRouteOperation(activateGoLive).catch(error => {
      logger?.error(`A ativação automática iniciada com o Windows falhou: ${errorMessage(error)}`);
      if (!shutdownCoordinator.isStopping) setStatus("error", "Falha na ativação automática.");
    });
  }
});

app.on("window-all-closed", () => {
  // Keep the router alive in the tray while Discord is using it.
});

app.on("activate", showWindow);

app.on("before-quit", event => {
  if (allowQuitAfterCleanup) return;
  event.preventDefault();
  void requestApplicationQuit("application");
});
