import assert from "node:assert/strict";
import test from "node:test";
import { parseSocksProxy } from "./upstream-socks.js";

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
