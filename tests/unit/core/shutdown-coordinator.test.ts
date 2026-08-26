import assert from "node:assert/strict";
import test from "node:test";
import { ShutdownCoordinator, type ShutdownReason } from "../../../src/core/shutdown-coordinator.js";

test("shutdown is idempotent and blocks new operations immediately", async () => {
  let releaseCleanup!: () => void;
  let cleanups = 0;
  const coordinator = new ShutdownCoordinator(async () => {
    cleanups += 1;
    await new Promise<void>(resolve => { releaseCleanup = resolve; });
  });

  const first = coordinator.request("tray");
  const second = coordinator.request("application");
  assert.strictEqual(first, second);
  assert.equal(coordinator.phase, "stopping");
  assert.equal(coordinator.reason, "tray");
  assert.equal(coordinator.signal.aborted, true);
  assert.throws(() => coordinator.assertRunning(), /está sendo encerrado/);

  releaseCleanup();
  await first;
  assert.equal(cleanups, 1);
  assert.equal(coordinator.phase, "stopped");
});

test("tray, application and Windows shutdown reasons use the same coordinated cleanup", async () => {
  const reasons: ShutdownReason[] = ["tray", "application", "windows-session"];
  for (const reason of reasons) {
    let observed: ShutdownReason | undefined;
    const coordinator = new ShutdownCoordinator(async selectedReason => { observed = selectedReason; });
    await coordinator.request(reason);
    assert.equal(observed, reason);
    assert.equal(coordinator.phase, "stopped");
  }
});

test("forced Windows shutdown aborts work and invokes only the registered fallback", () => {
  let forced = 0;
  const coordinator = new ShutdownCoordinator(async () => undefined, () => { forced += 1; });
  coordinator.force("windows-session");
  coordinator.force("windows-session");
  assert.equal(coordinator.signal.aborted, true);
  assert.equal(forced, 1);
});
