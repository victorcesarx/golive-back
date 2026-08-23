export interface StartupCommand {
  executable: string;
  args: string[];
}

export function resolveStartupCommand(options: {
  portableExecutable?: string;
  processExecutable: string;
  appPath: string;
  packaged: boolean;
}): StartupCommand {
  if (options.portableExecutable) {
    return { executable: options.portableExecutable, args: ["--hidden"] };
  }
  if (options.packaged) {
    return { executable: options.processExecutable, args: ["--hidden"] };
  }
  return { executable: options.processExecutable, args: [options.appPath, "--hidden"] };
}
