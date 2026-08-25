export type DiagnosticHealthStatus = "stopped" | "unknown" | "healthy" | "degraded" | "recovering" | "unhealthy";
export type ApplicationSignatureStatus = "development" | "valid" | "invalid" | "unsigned" | "unknown";

export interface DiagnosticSnapshot {
  generatedAt: string;
  application: {
    version: string;
    packaged: boolean;
    platform: string;
    signature: ApplicationSignatureStatus;
    publisher: string | null;
  };
  route: {
    phase: string;
    active: boolean;
    mode: "tor" | "manual";
    uptimeSeconds: number | null;
    startupSeconds: number | null;
    exitCountry: string | null;
    validationLatencyMs: number | null;
    lastValidationAt: string | null;
  };
  services: {
    tor: "integrated" | "external" | "inactive";
    pac: boolean;
    gatewayRouter: boolean;
    healthMonitor: boolean;
  };
  discord: {
    channel: string;
    version: string | null;
    selected: boolean;
    running: boolean;
  };
  health: {
    status: DiagnosticHealthStatus;
    consecutiveFailures: number;
    recoveries: number;
    lastCheckAt: string | null;
    lastError: string | null;
  };
}

function yesNo(value: boolean) {
  return value ? "sim" : "não";
}

function optional(value: string | number | null) {
  return value ?? "não disponível";
}

export function formatDiagnosticReport(snapshot: DiagnosticSnapshot): string {
  return [
    "GoLiveBack — diagnóstico local",
    `Gerado em: ${snapshot.generatedAt}`,
    "",
    `[Aplicação] versão=${snapshot.application.version} | empacotada=${yesNo(snapshot.application.packaged)} | plataforma=${snapshot.application.platform}`,
    `[Assinatura] estado=${snapshot.application.signature} | publicador=${optional(snapshot.application.publisher)}`,
    `[Rota] fase=${snapshot.route.phase} | ativa=${yesNo(snapshot.route.active)} | modo=${snapshot.route.mode}`,
    `[Rota] duração=${optional(snapshot.route.uptimeSeconds)}s | inicialização=${optional(snapshot.route.startupSeconds)}s`,
    `[Saída] país=${optional(snapshot.route.exitCountry)} | latência=${optional(snapshot.route.validationLatencyMs)}ms | validada=${optional(snapshot.route.lastValidationAt)}`,
    `[Serviços] Tor=${snapshot.services.tor} | PAC=${yesNo(snapshot.services.pac)} | roteador=${yesNo(snapshot.services.gatewayRouter)} | monitor=${yesNo(snapshot.services.healthMonitor)}`,
    `[Discord] selecionado=${yesNo(snapshot.discord.selected)} | canal=${snapshot.discord.channel} | versão=${optional(snapshot.discord.version)} | aberto=${yesNo(snapshot.discord.running)}`,
    `[Saúde] estado=${snapshot.health.status} | falhas=${snapshot.health.consecutiveFailures} | recuperações=${snapshot.health.recoveries}`,
    `[Saúde] última verificação=${optional(snapshot.health.lastCheckAt)} | último erro=${optional(snapshot.health.lastError)}`
  ].join("\n");
}
