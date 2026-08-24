import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
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

function parsePreferences(contents: string): Preferences | undefined {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Partial<Preferences>;
    return {
      channel: isChannel(candidate.channel) ? candidate.channel : DEFAULTS.channel,
      discordExecutable: isExecutablePath(candidate.discordExecutable) ? candidate.discordExecutable : null,
      routeMode: candidate.routeMode === "manual" ? "manual" : "tor",
      startWithWindows: candidate.startWithWindows === true
    };
  } catch {
    return undefined;
  }
}

async function readPreferences(file: string) {
  try {
    return parsePreferences(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeAtomic(file: string, contents: string) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class PreferenceStore {
  readonly file: string;
  readonly backupFile: string;
  private value: Preferences = { ...DEFAULTS };
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    this.file = path.join(directory, "preferences.json");
    this.backupFile = path.join(directory, "preferences.json.backup");
  }

  async load(): Promise<Preferences> {
    await this.removeInterruptedWrites();
    const primary = await readPreferences(this.file);
    if (primary) {
      this.value = primary;
      return this.get();
    }
    const backup = await readPreferences(this.backupFile);
    this.value = backup ?? { ...DEFAULTS };
    if (backup) await writeAtomic(this.file, this.serialize(backup));
    return this.get();
  }

  get(): Preferences {
    return { ...this.value };
  }

  update(patchValue: Partial<Preferences>): Promise<Preferences> {
    const operation = this.writeQueue.then(async () => {
      const next: Preferences = {
        channel: isChannel(patchValue.channel) ? patchValue.channel : this.value.channel,
        discordExecutable: patchValue.discordExecutable === null ? null : isExecutablePath(patchValue.discordExecutable) ? patchValue.discordExecutable : this.value.discordExecutable,
        routeMode: patchValue.routeMode === "manual" || patchValue.routeMode === "tor" ? patchValue.routeMode : this.value.routeMode,
        startWithWindows: typeof patchValue.startWithWindows === "boolean" ? patchValue.startWithWindows : this.value.startWithWindows
      };
      const previous = await readPreferences(this.file);
      if (previous) await writeAtomic(this.backupFile, this.serialize(previous));
      // Proxy addresses and credentials are deliberately not part of Preferences.
      await writeAtomic(this.file, this.serialize(next));
      this.value = next;
      return this.get();
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private serialize(value: Preferences) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  private async removeInterruptedWrites() {
    const directory = path.dirname(this.file);
    const prefixes = [`${path.basename(this.file)}.tmp-`, `${path.basename(this.backupFile)}.tmp-`];
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return;
    }
    await Promise.all(entries.filter(entry => prefixes.some(prefix => entry.startsWith(prefix))).map(entry => unlink(path.join(directory, entry)).catch(() => undefined)));
  }
}
