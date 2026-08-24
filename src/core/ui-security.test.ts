import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  isTrustedIpcSender,
  isTrustedRendererUrl,
  navigationTargetForLog,
  resolveUiResource,
  UI_ENTRY_URL
} from "./ui-security.js";

test("accepts only the exact trusted renderer document", () => {
  assert.equal(isTrustedRendererUrl(UI_ENTRY_URL), true);
  assert.equal(isTrustedRendererUrl(`${UI_ENTRY_URL}#status`), true);
  assert.equal(isTrustedRendererUrl("goliveback://ui/renderer.js"), false);
  assert.equal(isTrustedRendererUrl("goliveback://attacker/index.html"), false);
  assert.equal(isTrustedRendererUrl("https://ui/index.html"), false);
  assert.equal(isTrustedRendererUrl("goliveback://user@ui/index.html"), false);
  assert.equal(isTrustedRendererUrl("goliveback://ui/index.html?redirect=https://example.com"), false);
});

test("serves only allowlisted local UI resources", () => {
  const appRoot = path.resolve("C:\\application");
  assert.deepEqual(resolveUiResource(UI_ENTRY_URL, appRoot), {
    filePath: path.join(appRoot, "public", "index.html"),
    contentType: "text/html; charset=utf-8"
  });
  assert.equal(resolveUiResource("goliveback://ui/renderer.js", appRoot)?.contentType, "text/javascript; charset=utf-8");
  assert.equal(resolveUiResource("goliveback://ui/assets/app-icon.png", appRoot)?.contentType, "image/png");
  assert.equal(resolveUiResource("goliveback://ui/../package.json", appRoot), null);
  assert.equal(resolveUiResource("goliveback://ui/%2e%2e/package.json", appRoot), null);
  assert.equal(resolveUiResource("goliveback://ui/C:/Windows/win.ini", appRoot), null);
  assert.equal(resolveUiResource("goliveback://ui/index.html#fragment", appRoot), null);
});

test("trusts IPC only from the expected top-level WebContents and URL", () => {
  const valid = { senderId: 7, expectedSenderId: 7, frameUrl: UI_ENTRY_URL, isMainFrame: true };
  assert.equal(isTrustedIpcSender(valid), true);
  assert.equal(isTrustedIpcSender({ ...valid, senderId: 8 }), false);
  assert.equal(isTrustedIpcSender({ ...valid, isMainFrame: false }), false);
  assert.equal(isTrustedIpcSender({ ...valid, frameUrl: null }), false);
  assert.equal(isTrustedIpcSender({ ...valid, frameUrl: "https://example.com" }), false);
});

test("redacts credentials and paths from blocked navigation logs", () => {
  assert.equal(navigationTargetForLog("https://user:secret@example.com/private?token=secret"), "https://example.com");
  assert.equal(navigationTargetForLog("not a url"), "URL inválida");
});
