import { connect, type Socket } from "node:net";
import { SocketReader } from "./socket-reader.js";

export interface SocksProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function hasSocksProxyCredentials(proxy: SocksProxy) {
  return Boolean(proxy.username && proxy.password);
}

export function isLoopbackSocksProxy(proxy: SocksProxy) {
  const host = proxy.host.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host === "::1"
    || host.startsWith("::ffff:127.")
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function requiresRemoteSocksCredentialWarning(proxy: SocksProxy) {
  return hasSocksProxyCredentials(proxy) && !isLoopbackSocksProxy(proxy);
}

export function clearSocksProxyCredentials(proxy: SocksProxy | undefined) {
  if (!proxy) return;
  if (proxy.username !== undefined) proxy.username = "";
  if (proxy.password !== undefined) proxy.password = "";
  delete proxy.username;
  delete proxy.password;
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
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("SOCKS5 username and password must both be provided");
  }
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
    throw new Error("SOCKS5 credentials are too long");
  }
  return {
    host: url.hostname,
    port,
    ...(username ? { username, password } : {})
  };
}

async function writeSensitiveAuthentication(socket: Socket, usernameValue: string, passwordValue: string) {
  const username = Buffer.from(usernameValue);
  const password = Buffer.from(passwordValue);
  const payload = Buffer.concat([
    Buffer.from([1, username.length]),
    username,
    Buffer.from([password.length]),
    password
  ]);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.write(payload, error => error ? reject(error) : resolve());
    });
  } finally {
    username.fill(0);
    password.fill(0);
    payload.fill(0);
  }
}

export async function connectViaSocks5(proxy: SocksProxy, host: string, port: number): Promise<Socket> {
  const socket = connect({ host: proxy.host, port: proxy.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.setTimeout(8_000, () => socket.destroy(new Error("Proxy connection timed out")));
  });
  const reader = new SocketReader(socket);
  const hasCredentials = hasSocksProxyCredentials(proxy);
  socket.write(Buffer.from(hasCredentials ? [5, 2, 0, 2] : [5, 1, 0]));
  const greeting = await reader.read(2);
  if (greeting[0] !== 5 || greeting[1] === 255) throw new Error("SOCKS5 proxy rejected authentication methods");

  if (greeting[1] === 2) {
    if (!hasCredentials) throw new Error("SOCKS5 proxy requires credentials");
    await writeSensitiveAuthentication(socket, proxy.username ?? "", proxy.password ?? "");
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
  socket.setKeepAlive(true);
  return socket;
}
