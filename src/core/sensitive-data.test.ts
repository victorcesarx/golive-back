import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText } from "./sensitive-data.js";

test("redacts complete SOCKS5 URLs including the server address", () => {
  const result = redactSensitiveText("using socks5://alice:p%40ss@proxy.example:1080 now");
  assert.equal(result, "using socks5://[redigido] now");
  assert.doesNotMatch(result, /alice|p%40ss|proxy\.example/);
});

test("redacts named fields and explicit runtime secrets", () => {
  const result = redactSensitiveText(
    "username=alice password:secret failed at private.proxy.example",
    ["alice", "secret", "private.proxy.example"]
  );
  assert.doesNotMatch(result, /alice|secret|private\.proxy\.example/);
  assert.match(result, /username=\[redigido\]/);
  assert.match(result, /password:\[redigido\]/);
});
