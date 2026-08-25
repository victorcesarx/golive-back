import { createServer, type Server, type Socket } from "node:net";
import { SocketReader } from "./socket-reader.js";

const ALLOWED_HOSTS = new Set(["gateway.discord.gg", "remote-auth-gateway.discord.gg"]);
export type UpstreamConnector = (host: string, port: number) => Promise<Socket>;

export interface GatewayRouter {
  port: number;
  close(): Promise<void>;
}

export interface GatewayRouterOptions {
  maxConcurrentConnections?: number;
  maxConnectionAttempts?: number;
  rateWindowMs?: number;
  handshakeTimeoutMs?: number;
  maxHandshakeBufferBytes?: number;
}

const DEFAULT_OPTIONS: Required<GatewayRouterOptions> = {
  maxConcurrentConnections: 64,
  maxConnectionAttempts: 120,
  rateWindowMs: 10_000,
  handshakeTimeoutMs: 10_000,
  maxHandshakeBufferBytes: 64 * 1024
};

function reply(socket: Socket, code: number) {
  socket.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
}

function trackSocket(socket: Socket, sockets: Set<Socket>) {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

async function handleClient(client: Socket, connector: UpstreamConnector, sockets: Set<Socket>, options: Required<GatewayRouterOptions>) {
  const reader = new SocketReader(client, options.maxHandshakeBufferBytes);
  const greeting = await reader.read(2);
  if (greeting[0] !== 5) throw new Error("Unsupported SOCKS version");
  const methods = await reader.read(greeting[1] ?? 0);
  if (!methods.includes(0)) {
    client.end(Buffer.from([5, 255]));
    return;
  }
  client.write(Buffer.from([5, 0]));

  const request = await reader.read(4);
  if (request[0] !== 5 || request[1] !== 1 || request[3] !== 3) {
    reply(client, 7);
    client.end();
    return;
  }
  const hostLength = (await reader.read(1))[0];
  if (!hostLength) throw new Error("Missing destination hostname");
  const host = (await reader.read(hostLength)).toString("ascii").toLowerCase();
  const port = (await reader.read(2)).readUInt16BE(0);
  if (!ALLOWED_HOSTS.has(host) || port !== 443) {
    reply(client, 2);
    client.end();
    return;
  }

  let upstream: Socket;
  try {
    upstream = await connector(host, port);
    trackSocket(upstream, sockets);
  } catch {
    reply(client, 5);
    client.end();
    return;
  }
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };
  client.once("error", closeBoth);
  upstream.once("error", closeBoth);
  client.once("close", () => upstream.destroy());
  upstream.once("close", () => client.destroy());
  client.setTimeout(0);
  client.setKeepAlive(true);
  upstream.setKeepAlive(true);
  reply(client, 0);
  const buffered = reader.release();
  if (buffered.length > 0) upstream.write(buffered);
  client.pipe(upstream);
  upstream.pipe(client);
}

function normalizeOptions(options: GatewayRouterOptions): Required<GatewayRouterOptions> {
  const normalized = { ...DEFAULT_OPTIONS, ...options };
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (normalized.maxHandshakeBufferBytes < 512) throw new RangeError("maxHandshakeBufferBytes must be at least 512 bytes");
  return normalized;
}

export async function startGatewayRouter(connector: UpstreamConnector, options: GatewayRouterOptions = {}): Promise<GatewayRouter> {
  const limits = normalizeOptions(options);
  const sockets = new Set<Socket>();
  const clients = new Set<Socket>();
  const connectionAttempts: number[] = [];
  const server: Server = createServer(client => {
    const now = Date.now();
    while (connectionAttempts.length > 0 && now - (connectionAttempts[0] ?? now) >= limits.rateWindowMs) connectionAttempts.shift();
    if (connectionAttempts.length >= limits.maxConnectionAttempts) {
      client.destroy();
      return;
    }
    connectionAttempts.push(now);
    if (clients.size >= limits.maxConcurrentConnections) {
      client.destroy();
      return;
    }
    clients.add(client);
    client.once("close", () => clients.delete(client));
    trackSocket(client, sockets);
    client.setNoDelay(true);
    client.setTimeout(limits.handshakeTimeoutMs, () => client.destroy());
    handleClient(client, connector, sockets, limits).catch(() => client.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Gateway router did not bind to TCP");
  let closePromise: Promise<void> | undefined;
  return {
    port: address.port,
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    }
  };
}
