import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyDiscordExecutable, discoverDiscord, inspectDiscordExecutable } from "../../../src/core/discord.js";
import type { WindowsExecutableMetadata } from "../../../src/core/windows-executable.js";

function metadata(overrides: Partial<WindowsExecutableMetadata> = {}): WindowsExecutableMetadata {
  return {
    path: "C:\\Discord\\Discord.exe",
    signatureStatus: "Valid",
    signerSubject: "CN=Discord Inc., O=Discord Inc., C=US",
    productName: "Discord",
    fileDescription: "Discord",
    companyName: "Discord Inc.",
    fileVersion: "1.0.9253",
    ...overrides
  };
}

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

test("accepts a signed compatible Discord distribution with confirmation required", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-custom-discord-"));
  const executable = path.join(directory, "DiscordDevelopment.exe");
  await writeFile(executable, "executable");
  const installation = await inspectDiscordExecutable(executable, async resolved => metadata({
    path: resolved,
    signerSubject: "CN=Example Client LLC, O=Example Client LLC, C=US",
    companyName: "Example Client LLC",
    productName: "Discord Development"
  }));
  assert.equal(installation.channel, "custom");
  assert.equal(installation.version, "1.0.9253");
  assert.equal(installation.executable, executable);
  assert.equal(installation.trust, "compatible");
  assert.equal(installation.requiresConfirmation, true);
});

test("rejects an invalid manual executable", async () => {
  await assert.rejects(inspectDiscordExecutable("C:\\missing\\Discord.txt"), /\.exe válido/);
});

test("rejects an unsigned executable even when it is named Discord", () => {
  assert.throws(
    () => classifyDiscordExecutable("C:\\Apps\\Discord.exe", metadata({ signatureStatus: "NotSigned", signerSubject: null })),
    /assinatura digital válida/
  );
});

test("rejects an unrelated signed executable", () => {
  assert.throws(
    () => classifyDiscordExecutable("C:\\Windows\\explorer.exe", metadata({
      signerSubject: "CN=Microsoft Windows, O=Microsoft Corporation, C=US",
      productName: "Microsoft Windows",
      fileDescription: "Windows Explorer",
      companyName: "Microsoft Corporation"
    })),
    /não foi reconhecido/
  );
});

test("recognizes an official Discord executable without confirmation", () => {
  const result = classifyDiscordExecutable("C:\\Discord\\Discord.exe", metadata());
  assert.equal(result.trust, "official");
  assert.equal(result.requiresConfirmation, false);
});
