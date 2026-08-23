import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscordChannel } from "./discord.js";

export interface Preferences {
  channel: DiscordChannel;
  discordExecutable: string | null;
  routeMode: "tor" | "manual";
  startWithWindows: boolean;
}

const DEFAULTS: Preferences = { channel: "stable", discordExecutable: null, routeMode: "tor", startWithWindows: false };

function isChannel(value: unknown): value is DiscordChannel {
  return value === "stable" || value === "ptb" || value === "canary" || value === "custom";
}

function isExecutablePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32_767 && path.isAbsolute(value) && path.extname(value).toLowerCase() === ".exe";
}

export class PreferenceStore {
  readonly file: string;
  private value: Preferences = { ...DEFAULTS };

  constructor(directory: string) {
    this.file = path.join(directory, "preferences.json");
  }

  async load(): Promise<Preferences> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        const candidate = parsed as Partial<Preferences>;
        this.value = {
          channel: isChannel(candidate.channel) ? candidate.channel : DEFAULTS.channel,
          discordExecutable: isExecutablePath(candidate.discordExecutable) ? candidate.discordExecutable : null,
          routeMode: candidate.routeMode === "manual" ? "manual" : "tor",
          startWithWindows: candidate.startWithWindows === true
        };
      }
    } catch {
      this.value = { ...DEFAULTS };
    }
    return this.get();
  }

  get(): Preferences {
    return { ...this.value };
  }

  async update(patchValue: Partial<Preferences>): Promise<Preferences> {
    this.value = {
      channel: isChannel(patchValue.channel) ? patchValue.channel : this.value.channel,
      discordExecutable: patchValue.discordExecutable === null ? null : isExecutablePath(patchValue.discordExecutable) ? patchValue.discordExecutable : this.value.discordExecutable,
      routeMode: patchValue.routeMode === "manual" || patchValue.routeMode === "tor" ? patchValue.routeMode : this.value.routeMode,
      startWithWindows: typeof patchValue.startWithWindows === "boolean" ? patchValue.startWithWindows : this.value.startWithWindows
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    // Proxy addresses and credentials are deliberately not part of Preferences.
    await writeFile(this.file, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
    return this.get();
  }
}
