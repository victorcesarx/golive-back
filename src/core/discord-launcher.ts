import { spawn } from "node:child_process";
import path from "node:path";
import type { DiscordInstallation } from "./discord.js";
import {
  listWindowsProcessesByExecutable,
  stopWindowsProcessesByExecutable,
  type WindowsProcessReference
} from "./windows-executable.js";

export interface DiscordProcessController {
  list(executable: string): Promise<WindowsProcessReference[]>;
  stop(executable: string): Promise<number[]>;
}

const windowsProcessController: DiscordProcessController = {
  list: listWindowsProcessesByExecutable,
  stop: stopWindowsProcessesByExecutable
};

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

export async function isDiscordRunning(
  installation: DiscordInstallation,
  controller: DiscordProcessController = windowsProcessController
): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Discord process detection is Windows-only in this MVP");
  return (await controller.list(installation.executable)).length > 0;
}

export async function stopDiscord(
  installation: DiscordInstallation,
  controller: DiscordProcessController = windowsProcessController
): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Discord process control is Windows-only in this MVP");
  if (!await isDiscordRunning(installation, controller)) return false;
  await controller.stop(installation.executable);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!await isDiscordRunning(installation, controller)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Discord ${discordProcessName(installation)} did not close in time`);
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
