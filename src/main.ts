import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { discoverDiscord, inspectDiscordExecutable, type DiscordInstallation } from "./core/discord.js";
import { startPacServer, type PacServer } from "./core/pac.js";
import { startGatewayRouter, type GatewayRouter } from "./core/gateway-router.js";
import { connectViaSocks5, parseSocksProxy, type SocksProxy } from "./core/upstream-socks.js";
import { findTorExit, validateExit, type ExitValidation } from "./core/exit-validator.js";
import { isDiscordRunning, launchDiscord, stopDiscord } from "./core/discord-launcher.js";
import { AppLogger } from "./core/logger.js";
import { PreferenceStore } from "./core/preferences.js";
import { startManagedTor, type ManagedTorInstance } from "./core/managed-tor.js";
import { HealthMonitor } from "./core/health-monitor.js";
import { resolveStartupCommand } from "./core/startup.js";

let pacServer: PacServer | undefined;
let gatewayRouter: GatewayRouter | undefined;
let activeProxy: SocksProxy | undefined;
let activeProxyReference: { current: SocksProxy } | undefined;
let activeValidation: ExitValidation | undefined;
let mainWindow: BrowserWindow | undefined;
let logger: AppLogger | undefined;
let monitoredDiscord: DiscordInstallation | undefined;
let monitorTimer: NodeJS.Timeout | undefined;
let preferences: PreferenceStore | undefined;
let tray: Tray | undefined;
let quitting = false;
let managedTor: ManagedTorInstance | undefined;
let healthMonitor: HealthMonitor | undefined;
let routeRecovery: Promise<boolean> | undefined;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", showWindow);

type AppPhase = "idle" | "validating" | "ready" | "discord-running" | "recovering" | "error";
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

function proxyFailureMessage(error: unknown) {
  const message = errorMessage(error);
  if (/Invalid URL/i.test(message)) return "O endereço está incompleto. Use o formato socks5://servidor:porta.";
  if (/Only socks5/i.test(message)) return "Somente proxies SOCKS5 são aceitas. Comece o endereço com socks5://.";
  if (/Invalid SOCKS5 proxy address/i.test(message)) return "O servidor ou a porta da proxy SOCKS5 é inválido.";
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
  return message;
}

function safeProxy(proxy: SocksProxy | undefined) {
  if (!proxy) return null;
  return `socks5://${proxy.username ? "***:***@" : ""}${proxy.host}:${proxy.port}`;
}

async function stopRoute(stopTor = true, announce = true) {
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
  pacServer = undefined;
  gatewayRouter = undefined;
  activeProxy = undefined;
  activeProxyReference = undefined;
  activeValidation = undefined;
  const tor = stopTor ? managedTor : undefined;
  if (stopTor) managedTor = undefined;
  await pac?.close();
  await router?.close();
  await tor?.stop();
  if (announce) {
    routeActivationStartedAt = undefined;
    routeStartupDurationMs = undefined;
    setStatus("idle", "Rota desativada.", "Ative o GoLive para criar uma rota");
  }
}

function managedTorBundleRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "tor") : path.join(app.getAppPath(), "vendor", "tor");
}

function startupCommand() {
  return resolveStartupCommand({
    ...(process.env.PORTABLE_EXECUTABLE_FILE ? { portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE } : {}),
    processExecutable: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged
  });
}

async function setStartWithWindows(enabled: boolean) {
  if (process.platform !== "win32") throw new Error("Automatic startup is Windows-only in this MVP");
  const command = startupCommand();
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: command.executable,
    args: command.args
  });
  await preferences?.update({ startWithWindows: enabled });
  logger?.info(`Inicialização automática ${enabled ? "ativada" : "desativada"}. Executável: ${command.executable}`);
  updateTrayMenu();
  return { success: true, enabled };
}

async function bootManagedTor() {
  managedTor = await startManagedTor(managedTorBundleRoot(), path.join(app.getPath("userData"), "tor-data"), line => {
    const progress = /Bootstrapped (\d+)%/.exec(line)?.[1];
    if (progress) setStatus("validating", `Tor conectando: ${progress}%`);
    logger?.info(`Detalhe do Tor: ${line}`);
  });
  return { host: "127.0.0.1", port: managedTor.port } satisfies SocksProxy;
}

async function activateRoute(proxyValue: unknown) {
  if (typeof proxyValue !== "string" || proxyValue.length > 2_048) throw new Error("O endereço informado para a proxy é inválido.");
  if (runtimeStatus.phase === "validating" || runtimeStatus.phase === "recovering") throw new Error("Aguarde a operação atual da rota terminar antes de analisar outra proxy.");
  const previousStatus = runtimeStatus;
  const previousRoute = { pacServer, gatewayRouter, activeProxy };
  const hadActiveRoute = Boolean(previousRoute.pacServer && previousRoute.gatewayRouter && previousRoute.activeProxy);
  beginRouteTiming();
  logger?.info(`Análise de proxy personalizada iniciada. ${hadActiveRoute ? "A rota atual será preservada até a nova rota estar pronta." : "Nenhuma rota atual será alterada durante a análise."}`);
  setStatus("validating", "Analisando nova proxy…", hadActiveRoute ? "A rota atual permanece ativa" : "Verificando conexão e localização");
  try {
    const proxy = parseSocksProxy(proxyValue.trim());
    const validation = await validateExit(proxy);
    logger?.info(`A proxy personalizada foi validada. Saída: ${validation.country} (${validation.ip}). Preparando a substituição da rota.`);
    const result = await installRoute(proxy, validation);
    await (preferences?.update({ routeMode: "manual" }) ?? Promise.resolve()).catch(error => {
      logger?.error(`A nova rota está ativa, mas a preferência do modo manual não pôde ser salva: ${errorMessage(error)}`);
    });
    return result;
  } catch (error) {
    routeActivationStartedAt = undefined;
    const currentRouteWasPreserved = pacServer === previousRoute.pacServer
      && gatewayRouter === previousRoute.gatewayRouter
      && activeProxy === previousRoute.activeProxy;
    const reason = proxyFailureMessage(error);
    logger?.error(`A proxy personalizada não foi aplicada: ${errorMessage(error)}. ${currentRouteWasPreserved && hadActiveRoute ? "A rota anterior continua ativa." : "Nenhuma rota foi alterada."}`);
    setStatus(previousStatus.phase, previousStatus.message, previousStatus.detail);
    throw new Error(`A proxy não foi aplicada. ${hadActiveRoute && currentRouteWasPreserved ? "A rota atual continua ativa. " : ""}Motivo: ${reason}`);
  }
}

async function activateTorRoute() {
  beginRouteTiming();
  logger?.info("Ativação do GoLive solicitada. Procurando uma saída Tor válida.");
  setStatus("validating", "Procurando saída Tor…");
  try {
    let found;
    try {
      found = await findTorExit();
      logger?.info(`Uma instalação do Tor já disponível foi encontrada na porta ${found.proxy.port}.`);
    } catch {
      setStatus("validating", "Iniciando Tor integrado…");
      await stopRoute(true, false);
      const proxy = await bootManagedTor();
      found = { proxy, validation: await validateExit(proxy) };
      logger?.info(`O Tor integrado ficou pronto na porta ${proxy.port}.`);
    }
    await preferences?.update({ routeMode: "tor" });
    return await installRoute(found.proxy, found.validation, managedTor !== undefined && found.proxy.port === managedTor.port);
  } catch (error) {
    routeActivationStartedAt = undefined;
    logger?.error(`Não foi possível preparar uma saída Tor válida: ${errorMessage(error)}`);
    setStatus("error", "Falha ao ativar o GoLive.");
    throw error;
  }
}

async function installRoute(proxy: SocksProxy, validation: ExitValidation, preserveManagedTor = false) {
  // Prepare the complete replacement before touching the live route. Capturing the candidate
  // reference also lets recovery replace its Tor circuit later without changing the local PAC.
  const candidateProxyReference = { current: proxy };
  const router = await startGatewayRouter((host, port) => {
    return connectViaSocks5(candidateProxyReference.current, host, port);
  });
  let pac: PacServer;
  try {
    pac = await startPacServer(router.port);
  } catch (error) {
    await router.close();
    throw error;
  }

  const previousPac = pacServer;
  const previousRouter = gatewayRouter;
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

  completeRouteTiming();
  logger?.info("A nova rota foi preparada e substituiu a rota anterior com segurança.");
  setStatus("ready", "Rota ativa. Reinicie o Discord", routeTimingDetail());
  startHealthMonitor();
  return { success: true, pacUrl: pac.url, proxy: safeProxy(proxy), exit: validation };
}

function startHealthMonitor() {
  healthMonitor?.stop();
  healthMonitor = new HealthMonitor(
    async () => {
      if (!activeProxy) throw new Error("No active proxy");
      activeValidation = await validateExit(activeProxy);
    },
    (failures, error) => logger?.error(`A verificação de saúde da rota falhou (${failures}/2): ${errorMessage(error)}`),
    async () => { await recoverRoute(); },
    { intervalMs: 60_000, failureThreshold: 2 }
  );
  healthMonitor.start();
}

async function recoverRoute(): Promise<boolean> {
  if (routeRecovery) return routeRecovery;
  routeRecovery = performRouteRecovery();
  try {
    return await routeRecovery;
  } finally {
    routeRecovery = undefined;
  }
}

async function performRouteRecovery(): Promise<boolean> {
  if (!activeProxy) return false;
  beginRouteTiming();
  logger?.info("A rota perdeu a validação. Iniciando recuperação automática.");
  setStatus("recovering", "Recuperando rota…");
  try {
    if (preferences?.get().routeMode === "tor") {
      try {
        const found = await findTorExit();
        activeProxy = found.proxy;
        if (activeProxyReference) activeProxyReference.current = found.proxy;
        activeValidation = found.validation;
      } catch {
        await managedTor?.stop();
        managedTor = undefined;
        activeProxy = await bootManagedTor();
        if (activeProxyReference) activeProxyReference.current = activeProxy;
        activeValidation = await validateExit(activeProxy);
      }
    } else {
      activeValidation = await validateExit(activeProxy);
    }
    completeRouteTiming();
    const discordRunning = monitoredDiscord ? await isDiscordRunning(monitoredDiscord).catch(() => false) : false;
    setStatus(discordRunning ? "discord-running" : "ready", discordRunning ? "Rota ativa" : "Rota ativa. Reinicie o Discord", routeTimingDetail());
    return true;
  } catch (error) {
    routeActivationStartedAt = undefined;
    logger?.error(`A recuperação automática da rota falhou: ${errorMessage(error)}`);
    setStatus("error", "Rota indisponível.", "O Discord não será reiniciado");
    return false;
  }
}

async function ensureHealthyRouteBeforeRestart() {
  if (!activeProxy) throw new Error("A rota não está ativa.");
  const previousStatus = runtimeStatus;
  const proxyBeingChecked = activeProxy;
  logger?.info("Verificando a rota e o WebSocket do Discord antes de encerrar o cliente atual.");
  setStatus("validating", "Verificando rota…", "O Discord permanecerá aberto");
  try {
    activeValidation = await validateExit(proxyBeingChecked);
    setStatus(previousStatus.phase, previousStatus.message, previousStatus.detail);
    logger?.info("A rota respondeu ao handshake WebSocket do Discord. O reinício pode continuar.");
  } catch (error) {
    logger?.error(`A verificação anterior ao reinício falhou: ${errorMessage(error)}. O Discord atual será mantido aberto enquanto a rota é recuperada.`);
    const recovered = await recoverRoute();
    if (!recovered) {
      throw new Error("A rota não respondeu e não pôde ser recuperada. O Discord foi mantido aberto para evitar a tela de carregamento infinito.");
    }
    logger?.info("A rota foi recuperada e validada antes do reinício do Discord.");
  }
}

async function diagnose() {
  const installations = await availableDiscordInstallations();
  return {
    platform: process.platform,
    architecture: process.arch,
    discord: installations,
    pac: pacServer ? { running: true, url: pacServer.url } : { running: false },
    router: gatewayRouter ? { running: true, port: gatewayRouter.port } : { running: false },
    proxy: safeProxy(activeProxy),
    exit: activeValidation ?? null,
    status: runtimeStatus,
    logFile: logger?.file ?? null,
    log: await logger?.tail() ?? "",
    preferences: preferences?.get() ?? null,
    nextAction: activeProxy ? "A rota está disponível para o Discord." : "Ative o GoLive para preparar uma rota."
  };
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
      sandbox: true
    }
  });
  mainWindow = window;
  window.on("enter-full-screen", () => window.setFullScreen(false));
  window.on("close", event => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => { mainWindow = undefined; });
  await window.loadFile(path.join(app.getAppPath(), "public", "index.html"));
}

function showWindow() {
  mainWindow?.show();
  mainWindow?.focus();
}

function trayStatusIndicator(phase: AppPhase) {
  if (phase === "ready" || phase === "discord-running") return "🟢";
  if (phase === "validating" || phase === "recovering") return "🟡";
  if (phase === "error") return "🔴";
  return "⚪";
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
    { label: `${trayStatusIndicator(runtimeStatus.phase)} ${runtimeStatus.message}`, enabled: false },
    { type: "separator" },
    { label: `Build: ${selectedLabel}`, enabled: false },
    {
      label: routeActive ? "Desativar Rota" : "Ativar Rota",
      enabled: !routeBusy,
      click: () => {
        const action = routeActive ? stopRoute() : activateGoLive();
        void action.catch(error => {
          logger?.error(`A ação solicitada pela bandeja falhou: ${errorMessage(error)}`);
          setStatus("error", routeActive ? "Falha ao desativar a rota." : "Falha ao ativar o GoLive.");
        });
      }
    },
    { type: "separator" },
    { label: "Sair", click: () => { quitting = true; app.quit(); } }
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
  if (!configured) return discovered;
  try {
    const selected = await inspectDiscordExecutable(configured);
    return [selected, ...discovered.filter(item => item.executable.toLowerCase() !== selected.executable.toLowerCase())];
  } catch {
    return discovered;
  }
}

async function selectDiscordExecutable(executable: unknown) {
  if (typeof executable !== "string" || executable.length > 32_767) throw new Error("Caminho inválido para o Discord");
  const installation = await inspectDiscordExecutable(executable);
  await preferences?.update({ channel: installation.channel, discordExecutable: installation.executable });
  logger?.info(`Aplicação selecionada: ${discordLabel(installation)}. Executável: ${installation.executable}`);
  updateTrayMenu();
  return installation;
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
  return { canceled: false, installation: await selectDiscordExecutable(result.filePaths[0]) };
}

async function launchDiscordInstallation(installation: DiscordInstallation) {
  if (!pacServer || !gatewayRouter || !activeProxy) throw new Error("Activate and validate a route before opening Discord");
  const pid = await launchDiscord(installation, pacServer.url);
  const label = discordLabel(installation);
  logger?.info(`${label} ${installation.version} foi iniciado com a rota ativa. Processo: ${pid ?? "desconhecido"}.`);
  setStatus("discord-running", "Rota ativa", routeTimingDetail());
  startProcessMonitor(installation);
  return { success: true, installation, pid, pacUrl: pacServer.url };
}

async function activateGoLive() {
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
  if (!pacServer || !gatewayRouter || !activeProxy) throw new Error("Ative o GoLive antes de reiniciar o Discord.");
  const installations = await availableDiscordInstallations();
  let running: DiscordInstallation | undefined;
  for (const installation of installations) {
    if (await isDiscordRunning(installation)) {
      running = installation;
      break;
    }
  }
  if (!running) throw new Error("Nenhuma instância do Discord está aberta. Abra o Discord manualmente e tente novamente.");
  let discordWasStopped = false;
  try {
    await ensureHealthyRouteBeforeRestart();
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
    if (!monitoredDiscord) return;
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
  }, 2_000);
  monitorTimer.unref();
}

app.whenReady().then(async () => {
  app.setAppUserModelId("app.goliveback.desktop");
  logger = new AppLogger(app.getPath("userData"));
  preferences = new PreferenceStore(app.getPath("userData"));
  await preferences.load();
  logger.info(`GoLiveBack ${app.getVersion()} iniciado. Os registros desta sessão serão gravados neste arquivo.`);
  ipcMain.handle("app:diagnose", diagnose);
  ipcMain.handle("app:status", () => runtimeStatus);
  ipcMain.handle("app:open-log", async () => {
    if (!logger) throw new Error("O arquivo de log ainda não está disponível.");
    await logger.tail();
    const directory = path.dirname(logger.file);
    const openError = await shell.openPath(directory);
    if (openError) throw new Error(openError);
    logger.info(`A pasta de logs foi aberta. Arquivo atual: ${logger.file}`);
    return { success: true, directory, file: logger.file };
  });
  ipcMain.handle("preferences:get", () => preferences?.get());
  ipcMain.handle("discord:detect", detectDiscordInstallations);
  ipcMain.handle("discord:select", (_event, executable: unknown) => selectDiscordExecutable(executable));
  ipcMain.handle("discord:choose", chooseDiscordExecutable);
  ipcMain.handle("preferences:set-start-with-windows", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid automatic startup value");
    return setStartWithWindows(enabled);
  });
  ipcMain.handle("app:activate-golive", activateGoLive);
  ipcMain.handle("discord:restart", restartRunningDiscord);
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("route:activate", (_event, proxy: unknown) => activateRoute(proxy));
  ipcMain.handle("route:deactivate", async () => {
    await stopRoute();
    return { success: true };
  });
  await createWindow();
  createTray();
  if (process.argv.includes("--hidden")) {
    mainWindow?.hide();
    void activateGoLive().catch(error => {
      logger?.error(`A ativação automática iniciada com o Windows falhou: ${errorMessage(error)}`);
      setStatus("error", "Falha na ativação automática.");
    });
  }
});

app.on("window-all-closed", () => {
  // Keep the router alive in the tray while Discord is using it.
});

app.on("activate", showWindow);

app.on("before-quit", () => {
  quitting = true;
  if (monitorTimer) clearInterval(monitorTimer);
  void stopRoute();
});
