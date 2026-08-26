import assert from "node:assert/strict";
import test from "node:test";
import { resolveStartupCommand, resolveValidatedStartupCommand } from "../../../src/core/startup.js";
import type { WindowsExecutableMetadata } from "../../../src/core/windows-executable.js";

function metadata(executable: string, overrides: Partial<WindowsExecutableMetadata> = {}): WindowsExecutableMetadata {
  return {
    path: executable,
    signatureStatus: "Valid",
    signerSubject: "CN=GoLiveBack Software",
    productName: "GoLiveBack",
    fileDescription: "GoLiveBack Desktop",
    companyName: "GoLiveBack Software",
    fileVersion: "1.16.0",
    ...overrides
  };
}

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

test("signed portable launcher is accepted only when it matches the runtime signer", async () => {
  const portable = "C:\\Apps\\GoLiveBack-Portable-1.16.0-x64.exe";
  const runtime = "C:\\Temp\\GoLiveBack.exe";
  const command = await resolveValidatedStartupCommand({
    portableExecutable: portable,
    processExecutable: runtime,
    appPath: "C:\\Temp\\resources\\app.asar",
    packaged: true
  }, async executable => metadata(executable));
  assert.deepEqual(command, { executable: portable, args: ["--hidden"] });
});

test("unsigned or unrelated portable launchers are rejected", async () => {
  const options = {
    portableExecutable: "C:\\Apps\\GoLiveBack-Portable.exe",
    processExecutable: "C:\\Temp\\GoLiveBack.exe",
    appPath: "C:\\Temp\\resources\\app.asar",
    packaged: true
  };
  await assert.rejects(resolveValidatedStartupCommand(options, async executable => metadata(executable, { signatureStatus: "NotSigned", signerSubject: null })), /build oficial assinada/);
  await assert.rejects(resolveValidatedStartupCommand({ ...options, portableExecutable: "C:\\Apps\\notepad.exe" }, async executable => metadata(executable)), /não foi reconhecido/);
});

test("portable launcher signed by another publisher is rejected", async () => {
  const portable = "C:\\Apps\\GoLiveBack-Portable.exe";
  const runtime = "C:\\Temp\\GoLiveBack.exe";
  await assert.rejects(resolveValidatedStartupCommand({
    portableExecutable: portable,
    processExecutable: runtime,
    appPath: "C:\\Temp\\resources\\app.asar",
    packaged: true
  }, async executable => metadata(executable, executable === portable ? { signerSubject: "CN=Unexpected Publisher" } : {})), /publicadores diferentes/);
});
