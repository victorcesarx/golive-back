import assert from "node:assert/strict";
import test from "node:test";
import { formatDiagnosticReport, type DiagnosticSnapshot } from "./diagnostics.js";

test("formats a useful diagnostic report without paths, ports or exit IP", () => {
  const snapshot: DiagnosticSnapshot = {
    generatedAt: "2026-08-24T23:00:00.000Z",
    application: {
      version: "1.16.0", packaged: true, platform: "win32-x64",
      signature: "valid", publisher: "CN=GoLiveBack"
    },
    route: {
      phase: "ready", active: true, mode: "tor", uptimeSeconds: 42,
      startupSeconds: 10.1, exitCountry: "DE", validationLatencyMs: 850,
      lastValidationAt: "2026-08-24T22:59:00.000Z"
    },
    services: { tor: "integrated", pac: true, gatewayRouter: true, healthMonitor: true },
    discord: { channel: "stable", version: "1.0.9253", selected: true, running: true },
    health: { status: "healthy", consecutiveFailures: 0, recoveries: 1, lastCheckAt: "2026-08-24T22:59:00.000Z", lastError: null }
  };
  const report = formatDiagnosticReport(snapshot);
  assert.match(report, /país=DE.*latência=850ms/);
  assert.match(report, /estado=valid.*publicador=CN=GoLiveBack/);
  assert.match(report, /recuperações=1/);
  assert.doesNotMatch(report, /127\.0\.0\.1|\\Users\\|:\d{4,5}/);
});
