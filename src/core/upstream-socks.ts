import { connect, type Socket } from "node:net";
import { SocketReader } from "./socket-reader.js";

export interface SocksProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseSocksProxy(value: string): SocksProxy {
  const url = new URL(value);
  if (url.protocol !== "socks5:") throw new Error("Only socks5:// proxies are supported in this stage");
  const port = Number.parseInt(url.port, 10);
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid SOCKS5 proxy address");
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
    throw new Error("SOCKS5 credentials are too long");
  }
  return {
    host: url.hostname,
    port,
    ...(username ? { username, password } : {})
  };
}

export async function connectViaSocks5(proxy: SocksProxy, host: string, port: number): Promise<Socket> {
  const socket = connect({ host: proxy.host, port: proxy.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.setTimeout(8_000, () => socket.destroy(new Error("Proxy connection timed out")));
  });
  const reader = new SocketReader(socket);
  const hasCredentials = Boolean(proxy.username);
  socket.write(Buffer.from(hasCredentials ? [5, 2, 0, 2] : [5, 1, 0]));
  const greeting = await reader.read(2);
  if (greeting[0] !== 5 || greeting[1] === 255) throw new Error("SOCKS5 proxy rejected authentication methods");

  if (greeting[1] === 2) {
    if (!hasCredentials) throw new Error("SOCKS5 proxy requires credentials");
    const username = Buffer.from(proxy.username ?? "");
    const password = Buffer.from(proxy.password ?? "");
    socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]));
    const authentication = await reader.read(2);
    if (authentication[1] !== 0) throw new Error("SOCKS5 proxy rejected credentials");
  } else if (greeting[1] !== 0) {
    throw new Error(`Unsupported SOCKS5 authentication method ${greeting[1]}`);
  }

  const encodedHost = Buffer.from(host, "ascii");
  if (encodedHost.length === 0 || encodedHost.length > 255) throw new Error("Invalid destination hostname");
  const encodedPort = Buffer.alloc(2);
  encodedPort.writeUInt16BE(port);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, encodedHost.length]), encodedHost, encodedPort]));
  const header = await reader.read(4);
  if (header[0] !== 5 || header[1] !== 0) throw new Error(`SOCKS5 proxy could not connect (code ${header[1]})`);
  const addressLength = header[3] === 1 ? 4 : header[3] === 4 ? 16 : (await reader.read(1))[0];
  if (addressLength === undefined) throw new Error("Malformed SOCKS5 response");
  await reader.read(addressLength + 2);
  const buffered = reader.release();
  if (buffered.length > 0) socket.unshift(buffered);
  socket.setTimeout(0);
  return socket;
}
