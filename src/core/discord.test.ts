import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverDiscord, inspectDiscordExecutable } from "./discord.js";

test("discovers the newest standard Discord installation", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "goliveback-discord-"));
  const oldDirectory = path.join(localAppData, "Discord", "app-1.0.1");
  const newDirectory = path.join(localAppData, "Discord", "app-1.0.12");
  await mkdir(oldDirectory, { recursive: true });
  await mkdir(newDirectory, { recursive: true });
  await writeFile(path.join(oldDirectory, "Discord.exe"), "old");
  await writeFile(path.join(newDirectory, "Discord.exe"), "new");
  const installations = await discoverDiscord(localAppData);
  assert.equal(installations.length, 1);
  assert.equal(installations[0]?.version, "1.0.12");
});

test("accepts a manually selected Discord distribution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-custom-discord-"));
  const executable = path.join(directory, "Vesktop.exe");
  await writeFile(executable, "executable");
  const installation = await inspectDiscordExecutable(executable);
  assert.equal(installation.channel, "custom");
  assert.equal(installation.version, "manual");
  assert.equal(installation.executable, executable);
});

test("rejects an invalid manual executable", async () => {
  await assert.rejects(inspectDiscordExecutable("C:\\missing\\Discord.txt"), /\.exe válido/);
});
