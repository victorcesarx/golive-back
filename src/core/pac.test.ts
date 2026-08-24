import assert from "node:assert/strict";
import test from "node:test";
import { createPacScript, startPacServer } from "./pac.js";

test("PAC routes only Discord gateway hosts", () => {
  const script = createPacScript(32123);
  assert.match(script, /gateway\.discord\.gg/);
  assert.match(script, /remote-auth-gateway\.discord\.gg/);
  assert.match(script, /SOCKS5 127\.0\.0\.1:32123/);
  assert.match(script, /return "DIRECT"/);
});

test("PAC server binds to loopback and serves a private route", async () => {
  const server = await startPacServer(32123);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/proxy-[a-f0-9]{48}\.pac$/);
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SOCKS5 127\.0\.0\.1:32123/);
  } finally {
    await server.close();
  }
});

test("PAC shutdown is idempotent and releases its loopback port", async () => {
  const server = await startPacServer(32123);
  await Promise.all([server.close(), server.close()]);
  await assert.rejects(fetch(server.url));
});
