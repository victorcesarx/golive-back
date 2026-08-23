const activate = document.querySelector("#activate");
const restart = document.querySelector("#restart");
const proxy = document.querySelector("#proxy");
const output = document.querySelector("#output");
const statusCard = document.querySelector("#status-card");
const statusMessage = document.querySelector("#status-message");
const statusDetail = document.querySelector("#status-detail");
const statusBadge = document.querySelector("#status-badge");
const openLog = document.querySelector("#open-log");
const discordInstallation = document.querySelector("#discord-installation");
const discordPath = document.querySelector("#discord-path");
const chooseDiscord = document.querySelector("#choose-discord");
const advancedSettings = document.querySelector("details");
const scrollIndicator = document.querySelector("#scroll-indicator");
const startWithWindows = document.querySelector("#startWithWindows");
const protectedButton = document.querySelector("#protected");
const protectedLabel = protectedButton.querySelector("span");
const theme = document.querySelector("#theme");
const minimize = document.querySelector("#minimize");
const close = document.querySelector("#close");
const help = document.querySelector("#help");
const aboutModal = document.querySelector("#about-modal");
const closeAbout = document.querySelector("#close-about");
const controls = [activate, restart, openLog, discordInstallation, chooseDiscord, protectedButton, startWithWindows];
const badgeByPhase = { idle: "INATIVO", validating: "VALIDANDO", ready: "PRONTO", "discord-running": "PROTEGIDO", recovering: "RECUPERANDO", error: "ATENÇÃO" };
const detailByPhase = {
  idle: "Ative o GoLive para criar uma rota", validating: "Validando conexão segura.",
  ready: "Iniciada em 0 ms", "discord-running": "Iniciada em 0 ms",
  recovering: "Tentando restabelecer a saída.", error: "Abra o log para ver o que aconteceu."
};
let currentPhase = "idle";
let busy = false;
let detectedInstallations = [];

function installationLabel(installation) {
  if (installation.channel === "stable") return "Discord";
  if (installation.channel === "ptb") return "Discord PTB";
  if (installation.channel === "canary") return "Discord Canary";
  return installation.executable.split(/[\\/]/).pop().replace(/\.exe$/i, "");
}

function applyControlState() {
  for (const element of controls) element.disabled = busy;
  const routeReady = currentPhase === "ready" || currentPhase === "discord-running";
  const routeChanging = currentPhase === "validating" || currentPhase === "recovering";
  activate.disabled = busy || routeChanging;
  protectedButton.disabled = busy || routeChanging;
  protectedButton.classList.toggle("is-active", routeReady);
  protectedButton.title = routeReady ? "Desativar GoLive" : "Ativar GoLive";
  protectedButton.setAttribute("aria-label", routeReady ? "Desativar GoLive" : "Ativar GoLive");
  restart.disabled = busy || !routeReady;
  discordInstallation.disabled = busy || detectedInstallations.length === 0;
  protectedButton.setAttribute("aria-busy", String(busy));
}

function renderStatus(value) {
  currentPhase = value.phase;
  statusCard.dataset.phase = value.phase;
  statusMessage.textContent = value.message;
  statusDetail.textContent = value.detail ?? detailByPhase[value.phase] ?? "Estado atualizado.";
  statusBadge.textContent = badgeByPhase[value.phase] ?? "ESTADO";
  protectedLabel.textContent = value.phase === "ready" || value.phase === "discord-running" ? "GoLive ativo" : value.phase === "validating" ? "Ativando GoLive…" : "Ativar GoLive";
  applyControlState();
}

function renderDiscordInstallations(value) {
  detectedInstallations = value.installations ?? [];
  discordInstallation.replaceChildren();
  if (detectedInstallations.length === 0) {
    discordInstallation.add(new Option("Discord não encontrado", ""));
    discordPath.textContent = "Use “Selecionar executável” para informar outra distribuição.";
    discordPath.title = "";
  } else {
    for (const installation of detectedInstallations) {
      discordInstallation.add(new Option(installationLabel(installation), installation.executable));
    }
    const selected = value.selected ?? detectedInstallations[0];
    discordInstallation.value = selected.executable;
    discordPath.textContent = selected.executable;
    discordPath.title = selected.executable;
  }
  applyControlState();
}

function setBusy(value) {
  busy = value;
  applyControlState();
}

function showOutput(text, kind = "") {
  output.classList.add("visible");
  output.classList.remove("success", "error");
  if (kind) output.classList.add(kind);
  output.textContent = text;
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error:\s*/i, "")
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "");
}

async function run(action, revealOutput = true) {
  setBusy(true);
  if (revealOutput) {
    showOutput("Processando…");
  }
  try {
    const result = await action();
    if (revealOutput) output.textContent = JSON.stringify(result, null, 2);
    return result;
  } catch (error) {
    showOutput(`Falha: ${readableError(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshDiscord(showMissing = true) {
  const result = await run(() => window.gatewayRoute.detectDiscord(), false);
  if (!result) return;
  renderDiscordInstallations(result);
  if (showMissing && result.installations.length === 0) {
    showOutput("Discord não encontrado. Selecione o executável da sua distribuição.", "error");
  }
}

function updateScrollIndicator() {
  const hasMoreContent = window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 2;
  scrollIndicator.hidden = !hasMoreContent;
}

activate.addEventListener("click", async () => {
  setBusy(true);
  showOutput("Analisando a proxy informada…\n\nA rota atual permanecerá funcionando durante esta verificação.");
  try {
    const result = await window.gatewayRoute.activate(proxy.value);
    const exit = result.exit ? `${result.exit.country} · ${result.exit.ip}` : "validada";
    showOutput(`Proxy analisada e aplicada com sucesso.\n\nSaída: ${exit}\nReinicie o Discord para usar a nova rota.`, "success");
  } catch (error) {
    showOutput(`Não foi possível usar esta proxy.\n\n${readableError(error)}\n\nRevise o endereço ou as credenciais e tente novamente.`, "error");
  } finally {
    setBusy(false);
  }
});
restart.addEventListener("click", async () => {
  setBusy(true);
  try {
    await window.gatewayRoute.restartDiscord();
  } catch (error) {
    advancedSettings.open = true;
    showOutput(`O Discord não foi reiniciado.\n\n${readableError(error)}\n\nSua sessão atual foi preservada. Aguarde a rota ficar disponível e tente novamente.`, "error");
    window.requestAnimationFrame(updateScrollIndicator);
  } finally {
    setBusy(false);
  }
});
protectedButton.addEventListener("click", () => run(() => currentPhase === "ready" || currentPhase === "discord-running" ? window.gatewayRoute.deactivate() : window.gatewayRoute.activateGoLive(), false));
openLog.addEventListener("click", async () => {
  const originalLabel = openLog.textContent;
  openLog.disabled = true;
  openLog.textContent = "Abrindo…";
  try {
    const result = await window.gatewayRoute.openLog();
    showOutput(`Pasta de logs aberta.\n\nArquivo atual: ${result.file}`, "success");
    openLog.textContent = "Log aberto ✓";
    window.setTimeout(() => { openLog.textContent = originalLabel; }, 1_600);
  } catch (error) {
    showOutput(`Não foi possível abrir a pasta de logs: ${error instanceof Error ? error.message : String(error)}`, "error");
    openLog.textContent = originalLabel;
  } finally {
    openLog.disabled = false;
  }
});
chooseDiscord.addEventListener("click", async () => {
  const result = await run(() => window.gatewayRoute.chooseDiscord(), false);
  if (result && !result.canceled) await refreshDiscord(false);
});
discordInstallation.addEventListener("change", async () => {
  const selected = await run(() => window.gatewayRoute.selectDiscord(discordInstallation.value), false);
  if (selected) {
    discordPath.textContent = selected.executable;
    discordPath.title = selected.executable;
  }
});
startWithWindows.addEventListener("change", () => run(() => window.gatewayRoute.setStartWithWindows(startWithWindows.checked), false));
theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("goliveback-theme", next);
});
minimize.addEventListener("click", () => window.gatewayRoute.minimizeWindow());
close.addEventListener("click", () => window.gatewayRoute.closeWindow());
help.addEventListener("click", () => aboutModal.showModal());
closeAbout.addEventListener("click", () => aboutModal.close());
aboutModal.addEventListener("click", event => {
  if (event.target === aboutModal) aboutModal.close();
});
advancedSettings.addEventListener("toggle", () => {
  if (advancedSettings.open) refreshDiscord(false);
  window.requestAnimationFrame(updateScrollIndicator);
});
scrollIndicator.addEventListener("click", () => window.scrollBy({ top: Math.round(window.innerHeight * 0.6), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
window.addEventListener("scroll", updateScrollIndicator, { passive: true });
window.addEventListener("resize", updateScrollIndicator);
new ResizeObserver(updateScrollIndicator).observe(document.body);

document.documentElement.dataset.theme = localStorage.getItem("goliveback-theme") === "light" ? "light" : "dark";
window.gatewayRoute.onStatus(renderStatus);
window.gatewayRoute.getStatus().then(renderStatus);
window.gatewayRoute.getPreferences().then(value => { startWithWindows.checked = value.startWithWindows; });
refreshDiscord(false);
updateScrollIndicator();
