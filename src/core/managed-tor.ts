import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

export interface ManagedTorInstance {
  port: number;
  pid: number;
  stop(): Promise<void>;
  forceStop(): boolean;
}

export interface ManagedTorStartOptions {
  signal?: AbortSignal;
  bootstrapTimeoutMs?: number;
  stopGraceMs?: number;
  forceStopTimeoutMs?: number;
  useGeoIpFiles?: boolean;
}

export function managedTorArguments(
  port: number,
  stateDirectory: string,
  geoIpFiles?: { ipv4: string; ipv6: string }
): string[] {
  const argumentsList = [
    "--ignore-missing-torrc",
    "--ClientOnly", "1",
    "--SocksPort", `127.0.0.1:${port}`,
    "--SocksPolicy", "accept 127.0.0.1",
    "--SocksPolicy", "reject *",
    "--DataDirectory", stateDirectory
  ];
  if (geoIpFiles) {
    argumentsList.push("--GeoIPFile", geoIpFiles.ipv4, "--GeoIPv6File", geoIpFiles.ipv6);
  }
  argumentsList.push("--AvoidDiskWrites", "1", "--Log", "notice stdout");
  return argumentsList;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local Tor port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function hasExited(child: ChildProcess) {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    child.once("exit", onExit);
  });
}

function signalManagedProcess(child: ChildProcess, signal: NodeJS.Signals) {
  if (hasExited(child)) return false;
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

// This only signals the exact ChildProcess returned by GoLiveBack's spawn. It
// never searches for or terminates Tor processes by executable name.
export async function stopManagedProcess(child: ChildProcess, graceMs = 4_000, forceTimeoutMs = 2_000): Promise<void> {
  if (hasExited(child)) return;
  const gracefulExit = waitForExit(child, graceMs);
  signalManagedProcess(child, "SIGTERM");
  if (await gracefulExit) return;

  const forcedExit = waitForExit(child, forceTimeoutMs);
  signalManagedProcess(child, "SIGKILL");
  if (!await forcedExit && !hasExited(child)) {
    throw new Error(`Managed Tor process ${child.pid ?? "unknown"} did not terminate`);
  }
}

function bootstrapAbortError() {
  const error = new Error("Managed Tor bootstrap was canceled because GoLiveBack is shutting down");
  error.name = "AbortError";
  return error;
}

export function waitForTorBootstrap(
  child: ChildProcessWithoutNullStreams,
  onLog?: (line: string) => void,
  options: Pick<ManagedTorStartOptions, "signal" | "bootstrapTimeoutMs"> = {}
): Promise<void> {
  const timeoutMs = options.bootstrapTimeoutMs ?? 90_000;
  return new Promise((resolve, reject) => {
    let pending = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", consume);
      child.stderr.off("data", consume);
      child.off("error", onError);
      child.off("exit", onExit);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const consume = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        onLog?.(line);
        if (/Bootstrapped 100%.*Done/i.test(line)) finish();
      }
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(new Error(`Managed Tor exited before bootstrap (code ${code ?? "unknown"})`));
    const onAbort = () => finish(bootstrapAbortError());
    const timer = setTimeout(() => finish(new Error("Managed Tor did not bootstrap within 90 seconds")), timeoutMs);

    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", onError);
    child.once("exit", onExit);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}

export async function startManagedTor(
  bundleRoot: string,
  stateDirectory: string,
  onLog?: (line: string) => void,
  options: ManagedTorStartOptions = {}
): Promise<ManagedTorInstance> {
  if (process.platform !== "win32") throw new Error("Managed Tor is Windows-only in this MVP");
  if (options.signal?.aborted) throw bootstrapAbortError();
  const executable = path.join(bundleRoot, "tor", "tor.exe");
  const geoip = path.join(bundleRoot, "data", "geoip");
  const geoip6 = path.join(bundleRoot, "data", "geoip6");
  const requiredFiles = options.useGeoIpFiles === false ? [access(executable)] : [access(executable), access(geoip), access(geoip6)];
  await Promise.all(requiredFiles).catch(() => {
    throw new Error("The managed Tor bundle is missing or incomplete");
  });
  if (options.signal?.aborted) throw bootstrapAbortError();
  await mkdir(stateDirectory, { recursive: true });
  const port = await availablePort();
  if (options.signal?.aborted) throw bootstrapAbortError();
  const geoIpFiles = options.useGeoIpFiles === false ? undefined : { ipv4: geoip, ipv6: geoip6 };
  const child = spawn(executable, managedTorArguments(port, stateDirectory, geoIpFiles), { windowsHide: true });

  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= stopManagedProcess(child, options.stopGraceMs, options.forceStopTimeoutMs);
    return stopPromise;
  };
  const forceStop = () => signalManagedProcess(child, "SIGKILL");

  try {
    await waitForTorBootstrap(child, onLog, options);
  } catch (error) {
    await stop();
    throw error;
  }

  if (!child.pid) {
    await stop();
    throw new Error("Managed Tor started without a process identifier");
  }
  return { port, pid: child.pid, stop, forceStop };
}
