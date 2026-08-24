import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { managedTorArguments, stopManagedProcess, waitForTorBootstrap } from "./managed-tor.js";

function spawnNode(source: string) {
  return spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
}

test("managed Tor arguments only include GeoIP files when requested", () => {
  const withoutGeoIp = managedTorArguments(19050, "C:\\tor-state");
  assert.equal(withoutGeoIp.includes("--GeoIPFile"), false);
  assert.equal(withoutGeoIp.includes("--GeoIPv6File"), false);

  const withGeoIp = managedTorArguments(19050, "C:\\tor-state", {
    ipv4: "C:\\tor\\geoip",
    ipv6: "C:\\tor\\geoip6"
  });
  assert.deepEqual(withGeoIp.slice(-8, -4), [
    "--GeoIPFile", "C:\\tor\\geoip",
    "--GeoIPv6File", "C:\\tor\\geoip6"
  ]);
});

test("managed process shutdown waits for the exact spawned child to exit", async () => {
  const child = spawnNode("setInterval(() => {}, 1000)");
  await once(child, "spawn");
  const pid = child.pid;
  await stopManagedProcess(child, 500, 500);
  assert.equal(child.pid, pid);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("bootstrap cancellation rejects and the spawned child can be cleaned up", async () => {
  const child = spawnNode("setInterval(() => {}, 1000)");
  await once(child, "spawn");
  const controller = new AbortController();
  const bootstrap = waitForTorBootstrap(child, undefined, { signal: controller.signal, bootstrapTimeoutMs: 5_000 });
  controller.abort();
  await assert.rejects(bootstrap, (error: Error) => error.name === "AbortError");
  await stopManagedProcess(child, 500, 500);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("bootstrap failure reports an early child exit", async () => {
  const child = spawnNode("process.exit(17)");
  await once(child, "spawn");
  await assert.rejects(waitForTorBootstrap(child, undefined, { bootstrapTimeoutMs: 5_000 }), /code 17/);
  assert.equal(child.exitCode, 17);
});
