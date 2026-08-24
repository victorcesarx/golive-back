import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import {
  clearSocksProxyCredentials,
  connectViaSocks5,
  hasSocksProxyCredentials,
  isLoopbackSocksProxy,
  parseSocksProxy,
  requiresRemoteSocksCredentialWarning
} from "./upstream-socks.js";

test("parses an authenticated SOCKS5 proxy", () => {
  assert.deepEqual(parseSocksProxy("socks5://user:p%40ss@proxy.example:1080"), {
    host: "proxy.example",
    port: 1080,
    username: "user",
    password: "p@ss"
  });
});

test("rejects unsupported proxy protocols", () => {
  assert.throws(() => parseSocksProxy("https://proxy.example:443"), /Only socks5/);
});

test("rejects incomplete SOCKS5 credentials", () => {
  assert.throws(() => parseSocksProxy("socks5://user@proxy.example:1080"), /both be provided/);
  assert.throws(() => parseSocksProxy("socks5://:password@proxy.example:1080"), /both be provided/);
});

test("distinguishes local proxies from remote credential exposure", () => {
  const ipv4 = parseSocksProxy("socks5://user:pass@127.0.0.1:1080");
  const ipv6 = parseSocksProxy("socks5://user:pass@[::1]:1080");
  const remote = parseSocksProxy("socks5://user:pass@proxy.example:1080");
  assert.equal(isLoopbackSocksProxy(ipv4), true);
  assert.equal(isLoopbackSocksProxy(ipv6), true);
  assert.equal(isLoopbackSocksProxy(remote), false);
  assert.equal(requiresRemoteSocksCredentialWarning(ipv4), false);
  assert.equal(requiresRemoteSocksCredentialWarning(remote), true);
  assert.equal(requiresRemoteSocksCredentialWarning(parseSocksProxy("socks5://proxy.example:1080")), false);
});

test("drops credential references when a proxy is retired", () => {
  const proxy = parseSocksProxy("socks5://user:pass@proxy.example:1080");
  assert.equal(hasSocksProxyCredentials(proxy), true);
  clearSocksProxyCredentials(proxy);
  assert.equal(hasSocksProxyCredentials(proxy), false);
  assert.equal("username" in proxy, false);
  assert.equal("password" in proxy, false);
});

test("keeps authenticated SOCKS5 negotiation working", async () => {
  let receivedUsername = "";
  let receivedPassword = "";
  const server = createServer(socket => {
    let buffered = Buffer.alloc(0);
    let state = "greeting";
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (state === "greeting" && buffered.length >= 4) {
        buffered = buffered.subarray(4);
        state = "authentication";
        socket.write(Buffer.from([5, 2]));
      }
      if (state === "authentication" && buffered.length >= 2) {
        const usernameLength = buffered[1] ?? 0;
        if (buffered.length < 3 + usernameLength) return;
        const passwordLength = buffered[2 + usernameLength] ?? 0;
        const totalLength = 3 + usernameLength + passwordLength;
        if (buffered.length < totalLength) return;
        receivedUsername = buffered.subarray(2, 2 + usernameLength).toString("utf8");
        receivedPassword = buffered.subarray(3 + usernameLength, totalLength).toString("utf8");
        buffered = buffered.subarray(totalLength);
        state = "connect";
        socket.write(Buffer.from([1, 0]));
      }
      if (state === "connect" && buffered.length >= 5) {
        const hostLength = buffered[4] ?? 0;
        if (buffered.length < 7 + hostLength) return;
        state = "connected";
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0x1f, 0x90]));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");

  const tunnel = await connectViaSocks5(
    { host: "127.0.0.1", port: address.port, username: "alice", password: "secret" },
    "gateway.discord.gg",
    443
  );
  assert.equal(receivedUsername, "alice");
  assert.equal(receivedPassword, "secret");
  tunnel.destroy();
  server.close();
  await once(server, "close");
});
