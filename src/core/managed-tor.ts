import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

export interface ManagedTorInstance {
  port: number;
  stop(): Promise<void>;
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

function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 4_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export async function startManagedTor(bundleRoot: string, stateDirectory: string, onLog?: (line: string) => void): Promise<ManagedTorInstance> {
  if (process.platform !== "win32") throw new Error("Managed Tor is Windows-only in this MVP");
  const executable = path.join(bundleRoot, "tor", "tor.exe");
  const geoip = path.join(bundleRoot, "data", "geoip");
  const geoip6 = path.join(bundleRoot, "data", "geoip6");
  await Promise.all([access(executable), access(geoip), access(geoip6)]).catch(() => {
    throw new Error("The managed Tor bundle is missing or incomplete");
  });
  await mkdir(stateDirectory, { recursive: true });
  const port = await availablePort();
  const child = spawn(executable, [
    "--ignore-missing-torrc",
    "--ClientOnly", "1",
    "--SocksPort", `127.0.0.1:${port}`,
    "--SocksPolicy", "accept 127.0.0.1",
    "--SocksPolicy", "reject *",
    "--DataDirectory", stateDirectory,
    "--GeoIPFile", geoip,
    "--GeoIPv6File", geoip6,
    "--AvoidDiskWrites", "1",
    "--Log", "notice stdout"
  ], { windowsHide: true });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Managed Tor did not bootstrap within 90 seconds")), 90_000);
      let pending = "";
      const consume = (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          onLog?.(line);
          if (/Bootstrapped 100%.*Done/i.test(line)) {
            clearTimeout(timer);
            resolve();
          }
        }
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", code => {
        clearTimeout(timer);
        reject(new Error(`Managed Tor exited before bootstrap (code ${code ?? "unknown"})`));
      });
    });
  } catch (error) {
    await stopProcess(child);
    throw error;
  }

  return { port, stop: () => stopProcess(child) };
}
