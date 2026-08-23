import { connect as connectTls, type TLSSocket } from "node:tls";
import { randomBytes } from "node:crypto";
import { connectViaSocks5, type SocksProxy } from "./upstream-socks.js";

const TRACE_HOST = "cloudflare.com";
const TRACE_PATH = "/cdn-cgi/trace";
const GATEWAY_HOST = "gateway.discord.gg";
const MAX_RESPONSE_BYTES = 64 * 1024;
const VALIDATION_TIMEOUT_MS = 8_000;

export interface ExitValidation {
  country: string;
  ip: string;
  latencyMs: number;
}

export function parseCloudflareTrace(response: string): Pick<ExitValidation, "country" | "ip"> {
  if (!/^HTTP\/1\.[01] 200\b/.test(response)) throw new Error("Cloudflare trace returned an unexpected status");
  const separator = response.indexOf("\r\n\r\n");
  const body = separator >= 0 ? response.slice(separator + 4) : response;
  // Cloudflare reports Tor exits as T1 instead of an ISO country code.
  const country = /(?:^|\n)loc=([A-Za-z0-9]{2})(?:\r?$)/m.exec(body)?.[1]?.toUpperCase();
  const ip = /(?:^|\n)ip=([^\r\n]+)(?:\r?$)/m.exec(body)?.[1]?.trim();
  if (!country || !ip) throw new Error("Cloudflare trace did not identify the exit");
  return { country, ip };
}

export function isDiscordWebSocketUpgrade(response: string): boolean {
  return /^HTTP\/1\.[01] 101\b/.test(response);
}

async function openVerifiedTls(proxy: SocksProxy, host: string): Promise<TLSSocket> {
  const tunnel = await connectViaSocks5(proxy, host, 443);
  return await new Promise<TLSSocket>((resolve, reject) => {
    const socket = connectTls({
      socket: tunnel,
      servername: host,
      rejectUnauthorized: true
    });
    const timer = setTimeout(() => socket.destroy(new Error(`TLS handshake with ${host} timed out`)), VALIDATION_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      if (!socket.authorized) {
        socket.destroy();
        reject(new Error(`TLS certificate for ${host} was not authorized`));
        return;
      }
      resolve(socket);
    });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function requestThroughProxy(proxy: SocksProxy, host: string, requestPath: string): Promise<string> {
  const socket = await openVerifiedTls(proxy, host);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => socket.destroy(new Error(`HTTPS request to ${host} timed out`)), VALIDATION_TIMEOUT_MS);
    socket.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        socket.destroy(new Error(`HTTPS response from ${host} was too large`));
        return;
      }
      chunks.push(chunk);
    });
    socket.once("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: GoLiveBack/0.15\r\nConnection: close\r\n\r\n`);
  });
}

async function validateDiscordWebSocket(proxy: SocksProxy): Promise<void> {
  const socket = await openVerifiedTls(proxy, GATEWAY_HOST);
  await new Promise<void>((resolve, reject) => {
    let response = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error("Discord WebSocket handshake timed out")), VALIDATION_TIMEOUT_MS);
    socket.on("data", chunk => {
      response += chunk.toString("utf8");
      if (response.length > MAX_RESPONSE_BYTES) {
        finish(new Error("Discord WebSocket handshake response was too large"));
        return;
      }
      const headerEnd = response.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headers = response.slice(0, headerEnd);
      if (!isDiscordWebSocketUpgrade(headers)) {
        finish(new Error("Discord gateway rejected the WebSocket handshake"));
        return;
      }
      finish();
    });
    socket.once("end", () => finish(new Error("Discord gateway closed before completing the WebSocket handshake")));
    socket.once("error", error => finish(error));
    const key = randomBytes(16).toString("base64");
    socket.write([
      "GET /?v=10&encoding=json HTTP/1.1",
      `Host: ${GATEWAY_HOST}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "Origin: https://discord.com",
      "\r\n"
    ].join("\r\n"));
  });
}

export async function validateExit(proxy: SocksProxy, excludedCountries = new Set(["BR"])): Promise<ExitValidation> {
  const started = Date.now();
  const trace = parseCloudflareTrace(await requestThroughProxy(proxy, TRACE_HOST, TRACE_PATH));
  if (excludedCountries.has(trace.country)) throw new Error(`Proxy exits through excluded country ${trace.country}`);

  await validateDiscordWebSocket(proxy);
  return { ...trace, latencyMs: Date.now() - started };
}

export async function findTorExit(
  excludedCountries = new Set(["BR"]),
  ports: readonly number[] = [9052, 9150, 9050, 9250],
  validator: typeof validateExit = validateExit
): Promise<{ proxy: SocksProxy; validation: ExitValidation }> {
  const failures: string[] = [];
  for (const port of ports) {
    const proxy: SocksProxy = { host: "127.0.0.1", port };
    try {
      return { proxy, validation: await validator(proxy, excludedCountries) };
    } catch (error) {
      failures.push(`${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Tor was not found on local ports (${failures.join("; ")})`);
}
