import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import { startGatewayRouter } from "./gateway-router.js";
import { SocketReader } from "./socket-reader.js";

async function request(port: number, host: string) {
  const socket = connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const reader = new SocketReader(socket);
  socket.write(Buffer.from([5, 1, 0]));
  assert.deepEqual(await reader.read(2), Buffer.from([5, 0]));
  const encodedHost = Buffer.from(host);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, encodedHost.length]), encodedHost, Buffer.from([1, 187])]));
  const response = await reader.read(10);
  socket.destroy();
  return response[1];
}

test("router refuses hosts outside the gateway allowlist", async () => {
  let connectorCalled = false;
  const router = await startGatewayRouter(async () => {
    connectorCalled = true;
    throw new Error("should not run");
  });
  try {
    assert.equal(await request(router.port, "example.com"), 2);
    assert.equal(connectorCalled, false);
  } finally {
    await router.close();
  }
});

test("router accepts an allowlisted gateway on port 443", async () => {
  let destination = "";
  const router = await startGatewayRouter(async (host, port) => {
    destination = `${host}:${port}`;
    throw new Error("simulated unavailable upstream");
  });
  try {
    assert.equal(await request(router.port, "gateway.discord.gg"), 5);
    assert.equal(destination, "gateway.discord.gg:443");
  } finally {
    await router.close();
  }
});
