import assert from "node:assert/strict";
import { once } from "node:events";
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

async function openClient(port: number) {
  const socket = connect({ host: "127.0.0.1", port });
  await once(socket, "connect");
  return socket;
}

async function waitForClose(socket: ReturnType<typeof connect>) {
  if (socket.destroyed) return;
  await once(socket, "close");
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

test("router shutdown destroys active clients and releases its loopback port", async () => {
  const router = await startGatewayRouter(async () => { throw new Error("unused"); });
  const client = connect({ host: "127.0.0.1", port: router.port });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });

  const clientClosed = once(client, "close");
  await Promise.all([router.close(), router.close()]);
  await clientClosed;
  assert.equal(client.destroyed, true);
  await new Promise<void>((resolve, reject) => {
    const probe = connect({ host: "127.0.0.1", port: router.port });
    probe.once("connect", () => {
      probe.destroy();
      reject(new Error("router port remained open after shutdown"));
    });
    probe.once("error", () => resolve());
  });
});

test("router enforces its concurrent connection limit", async () => {
  const router = await startGatewayRouter(async () => { throw new Error("unused"); }, {
    maxConcurrentConnections: 2,
    maxConnectionAttempts: 10,
    rateWindowMs: 60_000
  });
  const first = await openClient(router.port);
  const second = await openClient(router.port);
  const refused = await openClient(router.port);
  try {
    await waitForClose(refused);
    assert.equal(first.destroyed, false);
    assert.equal(second.destroyed, false);
  } finally {
    first.destroy();
    second.destroy();
    refused.destroy();
    await router.close();
  }
});

test("router rate limits repeated loopback connection attempts", async () => {
  const router = await startGatewayRouter(async () => { throw new Error("unused"); }, {
    maxConcurrentConnections: 10,
    maxConnectionAttempts: 2,
    rateWindowMs: 60_000
  });
  try {
    for (let index = 0; index < 2; index += 1) {
      const client = await openClient(router.port);
      client.destroy();
      await waitForClose(client);
    }
    const refused = await openClient(router.port);
    await waitForClose(refused);
  } finally {
    await router.close();
  }
});

test("router closes clients that exceed the SOCKS handshake buffer", async () => {
  let connectorCalled = false;
  const router = await startGatewayRouter(async () => {
    connectorCalled = true;
    throw new Error("unused");
  }, { maxHandshakeBufferBytes: 512 });
  const client = await openClient(router.port);
  try {
    client.write(Buffer.alloc(2_048, 1));
    await waitForClose(client);
    assert.equal(connectorCalled, false);
  } finally {
    client.destroy();
    await router.close();
  }
});

test("router closes malformed SOCKS negotiations on every error path", async () => {
  const router = await startGatewayRouter(async () => { throw new Error("unused"); });
  const client = await openClient(router.port);
  try {
    client.write(Buffer.from([4, 1, 0]));
    await waitForClose(client);
  } finally {
    client.destroy();
    await router.close();
  }
});
