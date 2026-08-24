import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppLogger } from "./logger.js";

test("logger redacts SOCKS credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "goliveback-test-"));
  const logger = new AppLogger(directory);
  logger.info("using socks5://alice:secret@example.test:1080");
  await logger.tail();
  const contents = await readFile(logger.file, "utf8");
  assert.doesNotMatch(contents, /alice|secret|example\.test/);
  assert.match(contents, /socks5:\/\/\[redigido\]/);
});
