import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferenceStore } from "../../../src/core/preferences.js";

test("preferences persist the selected Discord executable and safe route values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  const patchWithSensitiveExtras = {
    channel: "custom" as const,
    discordExecutable: "C:\\Apps\\Vesktop.exe",
    routeMode: "manual" as const,
    proxy: "socks5://alice:secret@private.proxy.example:1080",
    username: "alice",
    password: "secret"
  };
  await store.update(patchWithSensitiveExtras);
  assert.deepEqual(await new PreferenceStore(directory).load(), { channel: "custom", discordExecutable: "C:\\Apps\\Vesktop.exe", routeMode: "manual", startWithWindows: false });
  assert.doesNotMatch(await readFile(store.file, "utf8"), /proxy|password|credential|alice|secret/i);
});

test("invalid preference file falls back safely", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  await writeFile(store.file, JSON.stringify({ channel: "unknown", routeMode: "bad" }));
  assert.deepEqual(await store.load(), { channel: "stable", discordExecutable: null, routeMode: "tor", startWithWindows: false });
});

test("interrupted or corrupted primary preferences recover from the last atomic backup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  await store.update({ channel: "ptb", routeMode: "tor" });
  await store.update({ channel: "canary", routeMode: "manual" });
  await writeFile(store.file, "{ interrupted", "utf8");

  const recovered = await new PreferenceStore(directory).load();
  assert.deepEqual(recovered, { channel: "ptb", discordExecutable: null, routeMode: "tor", startWithWindows: false });
  assert.deepEqual(JSON.parse(await readFile(store.file, "utf8")), recovered);
});

test("concurrent preference updates remain serialized and leave no temporary files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  await Promise.all([
    store.update({ channel: "ptb" }),
    store.update({ routeMode: "manual" }),
    store.update({ startWithWindows: true })
  ]);

  assert.deepEqual(await new PreferenceStore(directory).load(), {
    channel: "ptb",
    discordExecutable: null,
    routeMode: "manual",
    startWithWindows: true
  });
  assert.equal((await readdir(directory)).some(entry => entry.includes(".tmp-")), false);
});
