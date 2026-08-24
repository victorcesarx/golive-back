import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { inspectWindowsExecutable, type WindowsExecutableMetadata } from "./windows-executable.js";

export type DiscordChannel = "stable" | "ptb" | "canary" | "custom";
type KnownDiscordChannel = Exclude<DiscordChannel, "custom">;

export interface DiscordInstallation {
  channel: DiscordChannel;
  version: string;
  executable: string;
  root: string;
  trust?: "official" | "compatible";
  publisher?: string;
  productName?: string;
  requiresConfirmation?: boolean;
}

export type ExecutableInspector = (executable: string) => Promise<WindowsExecutableMetadata>;

const CHANNELS: ReadonlyArray<{ channel: KnownDiscordChannel; directory: string; executable: string }> = [
  { channel: "stable", directory: "Discord", executable: "Discord.exe" },
  { channel: "ptb", directory: "DiscordPTB", executable: "DiscordPTB.exe" },
  { channel: "canary", directory: "DiscordCanary", executable: "DiscordCanary.exe" }
];

function versionParts(version: string): number[] {
  return version.split(".").map(part => Number.parseInt(part, 10) || 0);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

export function classifyDiscordExecutable(
  executable: string,
  metadata: WindowsExecutableMetadata
): Pick<DiscordInstallation, "trust" | "publisher" | "productName" | "requiresConfirmation"> {
  const processName = path.basename(executable).toLowerCase();
  const knownName = processName === "discord.exe" || processName === "discordptb.exe" || processName === "discordcanary.exe";
  if (metadata.signatureStatus.toLowerCase() !== "valid" || !metadata.signerSubject) {
    throw new Error("O executável selecionado não possui uma assinatura digital válida");
  }

  const metadataText = [metadata.productName, metadata.fileDescription, metadata.companyName]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const hasDiscordIdentity = /discord/i.test(metadataText) && /discord/i.test(processName);
  if (!hasDiscordIdentity) {
    throw new Error("O executável selecionado não foi reconhecido como uma distribuição do Discord");
  }

  const officialPublisher = /(?:^|,\s*)(?:CN|O)=Discord Inc\.(?:,|$)/i.test(metadata.signerSubject);
  return {
    trust: officialPublisher && knownName ? "official" : "compatible",
    publisher: metadata.signerSubject,
    productName: metadata.productName ?? metadata.fileDescription ?? path.parse(executable).name,
    requiresConfirmation: !(officialPublisher && knownName)
  };
}

export async function inspectDiscordExecutable(
  executable: string,
  inspector: ExecutableInspector = inspectWindowsExecutable
): Promise<DiscordInstallation> {
  const resolved = path.resolve(executable);
  if (path.extname(resolved).toLowerCase() !== ".exe" || !await isFile(resolved)) {
    throw new Error("Selecione um executável .exe válido do Discord");
  }
  const metadata = await inspector(resolved);
  const classification = classifyDiscordExecutable(resolved, metadata);
  const processName = path.basename(resolved).toLowerCase();
  const channel: DiscordChannel = processName === "discord.exe" ? "stable"
    : processName === "discordptb.exe" ? "ptb"
      : processName === "discordcanary.exe" ? "canary"
        : "custom";
  const parent = path.basename(path.dirname(resolved));
  const version = /^app-(\d+(?:\.\d+)+)$/i.exec(parent)?.[1] ?? "manual";
  return {
    channel,
    version: metadata.fileVersion?.trim() || version,
    executable: resolved,
    root: path.dirname(resolved),
    ...classification
  };
}

export async function discoverDiscord(localAppData = process.env.LOCALAPPDATA): Promise<DiscordInstallation[]> {
  if (!localAppData) return [];
  const installations: DiscordInstallation[] = [];

  for (const definition of CHANNELS) {
    const root = path.join(localAppData, definition.directory);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }

    const candidates = entries
      .filter(entry => /^app-\d+(?:\.\d+)+$/i.test(entry))
      .map(entry => ({ entry, version: entry.slice(4) }))
      .sort((a, b) => compareVersions(b.version, a.version));

    for (const candidate of candidates) {
      const executable = path.join(root, candidate.entry, definition.executable);
      if (!(await isFile(executable))) continue;
      installations.push({
        channel: definition.channel,
        version: candidate.version,
        executable,
        root
      });
      break;
    }
  }

  return installations;
}
