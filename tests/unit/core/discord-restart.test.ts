import assert from "node:assert/strict";
import test from "node:test";
import { DiscordRestartGate } from "../../../src/core/discord-restart.js";

test("restart gate rejects concurrent attempts and enforces cooldown", () => {
  let now = 1_000;
  const gate = new DiscordRestartGate(10_000, () => now);
  const finish = gate.begin();
  assert.throws(() => gate.begin(), /já está em andamento/i);
  finish();
  finish();
  assert.throws(() => gate.begin(), /Aguarde 10s/i);
  now += 9_001;
  assert.throws(() => gate.begin(), /Aguarde 1s/i);
  now += 999;
  assert.doesNotThrow(() => gate.begin());
});
