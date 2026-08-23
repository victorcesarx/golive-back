import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DiscordInstallation } from "./discord.js";

const execFileAsync = promisify(execFile);

export function discordProcessName(installation: DiscordInstallation): string {
  return path.basename(installation.executable);
}

export function discordLaunchArguments(pacUrl: string): string[] {
  const url = new URL(pacUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("PAC URL must use the local loopback server");
  }
  return [`--proxy-pac-url=${url.toString()}`];
}

export async function isDiscordRunning(installation: DiscordInstallation): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Discord process detection is Windows-only in this MVP");
  const imageName = discordProcessName(installation);
  const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
    timeout: 5_000
  });
  return stdout.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
}

export async function stopDiscord(installation: DiscordInstallation): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Discord process control is Windows-only in this MVP");
  if (!await isDiscordRunning(installation)) return false;
  const imageName = discordProcessName(installation);
  try {
    await execFileAsync("taskkill.exe", ["/IM", imageName, "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000
    });
  } catch (error) {
    // Discord can finish between detection and taskkill. Only surface an error when
    // the process is still alive after that race.
    if (await isDiscordRunning(installation)) throw error;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!await isDiscordRunning(installation)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Discord ${imageName} did not close in time`);
}

export async function launchDiscord(installation: DiscordInstallation, pacUrl: string): Promise<number | undefined> {
  if (await isDiscordRunning(installation)) {
    throw new Error("Discord is already running. Quit it from the system tray and try again.");
  }
  const child = spawn(installation.executable, discordLaunchArguments(pacUrl), {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child.pid;
}
