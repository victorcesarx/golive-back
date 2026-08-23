import assert from "node:assert/strict";
import test from "node:test";
import { resolveStartupCommand } from "./startup.js";

test("portable startup uses the original launcher instead of temporary execPath", () => {
  assert.deepEqual(resolveStartupCommand({
    portableExecutable: "C:\\Apps\\GoLiveBack.exe",
    processExecutable: "C:\\Temp\\portable\\GoLiveBack.exe",
    appPath: "C:\\Temp\\portable\\resources\\app.asar",
    packaged: true
  }), {
    executable: "C:\\Apps\\GoLiveBack.exe",
    args: ["--hidden"]
  });
});

test("development startup includes the application path", () => {
  assert.deepEqual(resolveStartupCommand({
    processExecutable: "C:\\electron.exe",
    appPath: "C:\\project",
    packaged: false
  }), {
    executable: "C:\\electron.exe",
    args: ["C:\\project", "--hidden"]
  });
});
