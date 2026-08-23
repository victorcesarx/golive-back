import assert from "node:assert/strict";
import test from "node:test";
import { findTorExit, isDiscordWebSocketUpgrade, parseCloudflareTrace } from "./exit-validator.js";

test("parses country and IP from a Cloudflare trace", () => {
  const response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nfl=1\nip=203.0.113.7\nloc=DE\ntls=TLSv1.3\n";
  assert.deepEqual(parseCloudflareTrace(response), { country: "DE", ip: "203.0.113.7" });
});

test("rejects incomplete Cloudflare traces", () => {
  assert.throws(() => parseCloudflareTrace("HTTP/1.1 200 OK\r\n\r\nip=203.0.113.7\n"), /did not identify/);
});

test("accepts Cloudflare's T1 marker for a Tor exit", () => {
  const response = "HTTP/1.1 200 OK\r\n\r\nip=2001:db8::4\nloc=T1\n";
  assert.deepEqual(parseCloudflareTrace(response), { country: "T1", ip: "2001:db8::4" });
});

test("accepts only a successful Discord WebSocket upgrade", () => {
  assert.equal(isDiscordWebSocketUpgrade("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket"), true);
  assert.equal(isDiscordWebSocketUpgrade("HTTP/1.1 200 OK\r\nContent-Type: application/json"), false);
  assert.equal(isDiscordWebSocketUpgrade("HTTP/1.1 403 Forbidden\r\n"), false);
});

test("Tor detection advances through ports until validation succeeds", async () => {
  const attempted: number[] = [];
  const found = await findTorExit(new Set(["BR"]), [9052, 9150], async proxy => {
    attempted.push(proxy.port);
    if (proxy.port === 9052) throw new Error("closed");
    return { country: "NL", ip: "198.51.100.4", latencyMs: 20 };
  });
  assert.deepEqual(attempted, [9052, 9150]);
  assert.equal(found.proxy.port, 9150);
  assert.equal(found.validation.country, "NL");
});
