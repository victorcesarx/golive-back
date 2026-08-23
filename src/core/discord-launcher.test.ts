import assert from "node:assert/strict";
import test from "node:test";
import { discordLaunchArguments, discordProcessName } from "./discord-launcher.js";

test("builds a PAC argument only for a loopback HTTP URL", () => {
  assert.deepEqual(discordLaunchArguments("http://127.0.0.1:32100/proxy-a.pac"), [
    "--proxy-pac-url=http://127.0.0.1:32100/proxy-a.pac"
  ]);
  assert.throws(() => discordLaunchArguments("https://example.com/proxy.pac"), /loopback/);
});

test("maps every Discord channel to its Windows process", () => {
  assert.equal(discordProcessName({ channel: "stable", version: "1", root: "C:\\Discord", executable: "C:\\Discord\\Discord.exe" }), "Discord.exe");
  assert.equal(discordProcessName({ channel: "custom", version: "manual", root: "C:\\Apps", executable: "C:\\Apps\\Vesktop.exe" }), "Vesktop.exe");
});
