import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferenceStore } from "./preferences.js";

test("preferences persist the selected Discord executable and safe route values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  await store.update({ channel: "custom", discordExecutable: "C:\\Apps\\Vesktop.exe", routeMode: "manual" });
  assert.deepEqual(await new PreferenceStore(directory).load(), { channel: "custom", discordExecutable: "C:\\Apps\\Vesktop.exe", routeMode: "manual", startWithWindows: false });
  assert.doesNotMatch(await readFile(store.file, "utf8"), /proxy|password|credential/i);
});

test("invalid preference file falls back safely", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-prefs-"));
  const store = new PreferenceStore(directory);
  await writeFile(store.file, JSON.stringify({ channel: "unknown", routeMode: "bad" }));
  assert.deepEqual(await store.load(), { channel: "stable", discordExecutable: null, routeMode: "tor", startWithWindows: false });
});
