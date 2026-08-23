import assert from "node:assert/strict";
import test from "node:test";
import { HealthMonitor } from "./health-monitor.js";

test("health monitor recovers only after the configured failure threshold", async () => {
  let recoveries = 0;
  const failures: number[] = [];
  const monitor = new HealthMonitor(
    async () => { throw new Error("offline"); },
    count => failures.push(count),
    async () => { recoveries += 1; },
    { intervalMs: 60_000, failureThreshold: 2 }
  );
  await monitor.checkNow();
  assert.equal(recoveries, 0);
  await monitor.checkNow();
  assert.equal(recoveries, 1);
  assert.deepEqual(failures, [1, 2]);
});

test("successful check resets the failure counter", async () => {
  let shouldFail = true;
  let recoveries = 0;
  const monitor = new HealthMonitor(
    async () => { if (shouldFail) throw new Error("offline"); },
    () => undefined,
    async () => { recoveries += 1; },
    { intervalMs: 60_000, failureThreshold: 2 }
  );
  await monitor.checkNow();
  shouldFail = false;
  await monitor.checkNow();
  shouldFail = true;
  await monitor.checkNow();
  assert.equal(recoveries, 0);
});
