import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type DiscordChannel = "stable" | "ptb" | "canary" | "custom";
type KnownDiscordChannel = Exclude<DiscordChannel, "custom">;

export interface DiscordInstallation {
  channel: DiscordChannel;
  version: string;
  executable: string;
  root: string;
}

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

export async function inspectDiscordExecutable(executable: string): Promise<DiscordInstallation> {
  const resolved = path.resolve(executable);
  if (path.extname(resolved).toLowerCase() !== ".exe" || !await isFile(resolved)) {
    throw new Error("Selecione um executável .exe válido do Discord");
  }
  const processName = path.basename(resolved).toLowerCase();
  const channel: DiscordChannel = processName === "discord.exe" ? "stable"
    : processName === "discordptb.exe" ? "ptb"
      : processName === "discordcanary.exe" ? "canary"
        : "custom";
  const parent = path.basename(path.dirname(resolved));
  const version = /^app-(\d+(?:\.\d+)+)$/i.exec(parent)?.[1] ?? "manual";
  return { channel, version, executable: resolved, root: path.dirname(resolved) };
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
