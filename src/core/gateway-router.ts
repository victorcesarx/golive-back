import { createServer, type Server, type Socket } from "node:net";
import { SocketReader } from "./socket-reader.js";

const ALLOWED_HOSTS = new Set(["gateway.discord.gg", "remote-auth-gateway.discord.gg"]);
export type UpstreamConnector = (host: string, port: number) => Promise<Socket>;

export interface GatewayRouter {
  port: number;
  close(): Promise<void>;
}

function reply(socket: Socket, code: number) {
  socket.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
}

async function handleClient(client: Socket, connector: UpstreamConnector) {
  const reader = new SocketReader(client);
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
  } catch {
    reply(client, 5);
    client.end();
    return;
  }
  reply(client, 0);
  const buffered = reader.release();
  if (buffered.length > 0) upstream.write(buffered);
  client.pipe(upstream);
  upstream.pipe(client);
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };
  client.once("error", closeBoth);
  upstream.once("error", closeBoth);
}

export async function startGatewayRouter(connector: UpstreamConnector): Promise<GatewayRouter> {
  const server: Server = createServer(client => {
    client.setTimeout(10_000, () => client.destroy());
    handleClient(client, connector).catch(() => client.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Gateway router did not bind to TCP");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
