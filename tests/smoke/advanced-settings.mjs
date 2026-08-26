import { writeFile } from "node:fs/promises";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const screenshotPath = process.argv[3];
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Provide a valid DevTools port");

async function findTarget() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
      const target = targets.find(item => item.type === "page" && item.url.startsWith("goliveback://"));
      if (target) return target;
    } catch {
      // The isolated Electron instance may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The GoLiveBack renderer did not expose a DevTools target");
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
});

function call(method, params) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const readyDeadline = Date.now() + 15_000;
let rendererReady = false;
while (Date.now() < readyDeadline) {
  try {
    const readiness = await call("Runtime.evaluate", {
      expression: `document.readyState === "complete" && Boolean(document.querySelector("details")) && typeof window.gatewayRoute === "object"`,
      returnByValue: true
    });
    if (readiness.result?.value === true) {
      rendererReady = true;
      break;
    }
  } catch (error) {
    if (!/execution context|target navigated/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!rendererReady) throw new Error("The GoLiveBack renderer did not finish loading");
await new Promise(resolve => setTimeout(resolve, 200));

await call("Runtime.evaluate", {
  expression: `(() => {
    const details = document.querySelector("details");
    details.open = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    const footer = document.querySelector("footer.footnote");
    const footerRect = footer.getBoundingClientRect();
    window.__initialFooterState = {
      position: getComputedStyle(footer).position,
      bottomGap: Math.round((innerHeight - footerRect.bottom) * 100) / 100
    };
    window.__advancedSmokeStarted = performance.now();
    details.open = true;
  })();`,
  returnByValue: true
});
await new Promise(resolve => setTimeout(resolve, 250));
const evaluation = await call("Runtime.evaluate", {
  expression: `(() => {
    const footer = document.querySelector("footer.footnote");
    const footerRect = footer.getBoundingClientRect();
    document.querySelector("#help").click();
    const modalNumbering = [...document.querySelectorAll(".explain-list strong")]
      .map(element => element.textContent.trim().match(/^\\d+\\./)?.[0] ?? null);
    document.querySelector("#close-about").click();
    return {
      observedAfterMs: Math.round((performance.now() - window.__advancedSmokeStarted) * 100) / 100,
      detailsOpen: document.querySelector("details").open,
      protectedDisabled: document.querySelector("#protected").disabled,
      minimizeDisabled: document.querySelector("#minimize").disabled,
      closeDisabled: document.querySelector("#close").disabled,
      checkUpdateDisabled: document.querySelector("#check-update").disabled,
      secondaryActionIds: [...document.querySelectorAll(".secondary-actions button")].map(button => button.id),
      discordOptions: document.querySelector("#discord-installation").options.length,
      initialFooterPosition: window.__initialFooterState.position,
      initialFooterBottomGap: window.__initialFooterState.bottomGap,
      advancedFooterPosition: getComputedStyle(footer).position,
      advancedFooterDocumentBottomGap: Math.round((document.documentElement.scrollHeight - (footerRect.bottom + window.scrollY)) * 100) / 100,
      scrollIndicatorBottom: Number.parseFloat(getComputedStyle(document.querySelector("#scroll-indicator")).bottom),
      footerHeight: Math.round(footerRect.height * 100) / 100,
      modalNumbering
    };
  })()`,
  returnByValue: true
});

const result = evaluation.result?.value;
const expectedNumbering = ["1.", "2.", "3.", "4.", "5."];
if (
  !result?.detailsOpen
  || result.protectedDisabled
  || result.minimizeDisabled
  || result.closeDisabled
  || result.checkUpdateDisabled
  || JSON.stringify(result.secondaryActionIds) !== JSON.stringify(["open-log", "check-update"])
  || result.initialFooterPosition !== "fixed"
  || Math.abs(result.initialFooterBottomGap) > 0.5
  || result.advancedFooterPosition !== "static"
  || Math.abs(result.advancedFooterDocumentBottomGap) > 0.5
  || result.scrollIndicatorBottom !== 10
  || JSON.stringify(result.modalNumbering) !== JSON.stringify(expectedNumbering)
) {
  throw new Error(`Advanced settings smoke test failed: ${JSON.stringify(result)}`);
}
if (screenshotPath) {
  await call("Runtime.evaluate", {
    expression: `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });`,
    returnByValue: true
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const screenshot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
}
socket.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
