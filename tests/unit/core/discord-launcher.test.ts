import assert from "node:assert/strict";
import test from "node:test";
import {
  discordLaunchArguments,
  discordProcessName,
  isDiscordRunning,
  stopDiscord,
  waitForDiscordStability,
  type DiscordProcessController
} from "../../../src/core/discord-launcher.js";

test("builds a PAC argument only for a loopback HTTP URL", () => {
  assert.deepEqual(discordLaunchArguments("http://127.0.0.1:32100/proxy-a.pac"), [
    "--proxy-pac-url=http://127.0.0.1:32100/proxy-a.pac"
  ]);
  assert.throws(() => discordLaunchArguments("https://example.com/proxy.pac"), /loopback/);
});

test("confirms that Discord remains alive for the stability window", async () => {
  const installation = { channel: "stable" as const, version: "1", root: "C:\\Discord", executable: "C:\\Discord\\Discord.exe" };
  let now = 0;
  let checks = 0;
  const controller: DiscordProcessController = {
    async list(executable) {
      checks += 1;
      return [{ pid: 42, executable }];
    },
    async stop() { return []; }
  };
  await waitForDiscordStability(installation, {
    stableForMs: 1_000,
    pollIntervalMs: 250,
    controller,
    now: () => now,
    sleep: async milliseconds => { now += milliseconds; }
  });
  assert.equal(checks, 5);
});

test("rejects a Discord process that exits during protected startup", async () => {
  const installation = { channel: "stable" as const, version: "1", root: "C:\\Discord", executable: "C:\\Discord\\Discord.exe" };
  let now = 0;
  let checks = 0;
  const controller: DiscordProcessController = {
    async list(executable) {
      checks += 1;
      return checks < 3 ? [{ pid: 42, executable }] : [];
    },
    async stop() { return []; }
  };
  await assert.rejects(waitForDiscordStability(installation, {
    stableForMs: 1_000,
    pollIntervalMs: 250,
    controller,
    now: () => now,
    sleep: async milliseconds => { now += milliseconds; }
  }), /encerrou durante/i);
});

test("maps every Discord channel to its Windows process", () => {
  assert.equal(discordProcessName({ channel: "stable", version: "1", root: "C:\\Discord", executable: "C:\\Discord\\Discord.exe" }), "Discord.exe");
  assert.equal(discordProcessName({ channel: "custom", version: "manual", root: "C:\\Apps", executable: "C:\\Apps\\Vesktop.exe" }), "Vesktop.exe");
});

test("detects and stops Discord only by its exact executable path", async () => {
  const installation = { channel: "stable" as const, version: "1", root: "C:\\Discord", executable: "C:\\Discord\\Discord.exe" };
  let running = true;
  const calls: string[] = [];
  const controller: DiscordProcessController = {
    async list(executable) {
      calls.push(`list:${executable}`);
      return running ? [{ pid: 42, executable }] : [];
    },
    async stop(executable) {
      calls.push(`stop:${executable}`);
      running = false;
      return [42];
    }
  };

  assert.equal(await isDiscordRunning(installation, controller), true);
  assert.equal(await stopDiscord(installation, controller), true);
  assert.deepEqual(calls, [
    "list:C:\\Discord\\Discord.exe",
    "list:C:\\Discord\\Discord.exe",
    "stop:C:\\Discord\\Discord.exe",
    "list:C:\\Discord\\Discord.exe"
  ]);
});
