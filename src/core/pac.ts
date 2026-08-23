import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export interface PacServer {
  url: string;
  close(): Promise<void>;
}

const ROUTED_HOSTS = new Set([
  "gateway.discord.gg",
  "remote-auth-gateway.discord.gg"
]);

export function createPacScript(proxyPort: number): string {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new RangeError("proxyPort must be between 1 and 65535");
  }

  const hosts = JSON.stringify([...ROUTED_HOSTS]);
  return `function FindProxyForURL(url, host) {
  var routedHosts = ${hosts};
  host = host.toLowerCase();
  if (routedHosts.indexOf(host) !== -1) return "SOCKS5 127.0.0.1:${proxyPort}";
  return "DIRECT";
}\n`;
}

export async function startPacServer(proxyPort: number): Promise<PacServer> {
  const token = randomBytes(24).toString("hex");
  const route = `/proxy-${token}.pac`;
  const script = createPacScript(proxyPort);
  const server: Server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== route) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/x-ns-proxy-autoconfig",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(script)
    });
    response.end(script);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("PAC server did not bind to TCP");

  return {
    url: `http://127.0.0.1:${address.port}${route}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })
  };
}
