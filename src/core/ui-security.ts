import path from "node:path";

export const UI_SCHEME = "goliveback";
export const UI_HOST = "ui";
export const UI_ENTRY_URL = `${UI_SCHEME}://${UI_HOST}/index.html`;

export const UI_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'"
].join("; ");

interface UiResource {
  relativePath: readonly string[];
  contentType: string;
}

const UI_RESOURCES = new Map<string, UiResource>([
  ["/index.html", { relativePath: ["public", "index.html"], contentType: "text/html; charset=utf-8" }],
  ["/renderer.js", { relativePath: ["public", "renderer.js"], contentType: "text/javascript; charset=utf-8" }],
  ["/assets/app-icon.png", { relativePath: ["assets", "app-icon.png"], contentType: "image/png" }]
]);

function parseUiUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== `${UI_SCHEME}:` || url.hostname !== UI_HOST) return null;
    if (url.username || url.password || url.port || url.search) return null;
    return url;
  } catch {
    return null;
  }
}

export function isTrustedRendererUrl(value: string) {
  const url = parseUiUrl(value);
  return Boolean(url && url.pathname === "/index.html");
}

export function resolveUiResource(value: string, appRoot: string) {
  const url = parseUiUrl(value);
  if (!url || url.hash) return null;
  const resource = UI_RESOURCES.get(url.pathname);
  if (!resource) return null;
  return {
    filePath: path.join(appRoot, ...resource.relativePath),
    contentType: resource.contentType
  };
}

export interface IpcSenderIdentity {
  senderId: number;
  expectedSenderId: number;
  frameUrl: string | null;
  isMainFrame: boolean;
}

export function isTrustedIpcSender(identity: IpcSenderIdentity) {
  return identity.senderId === identity.expectedSenderId
    && identity.isMainFrame
    && identity.frameUrl !== null
    && isTrustedRendererUrl(identity.frameUrl);
}

export function navigationTargetForLog(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host || "sem-host"}`;
  } catch {
    return "URL inválida";
  }
}
