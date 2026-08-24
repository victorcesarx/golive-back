import path from "node:path";
import type { WindowsExecutableMetadata } from "./windows-executable.js";

export interface StartupCommand {
  executable: string;
  args: string[];
}

export type StartupExecutableInspector = (executable: string) => Promise<WindowsExecutableMetadata>;

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

function assertGoLiveBackExecutable(executable: string, metadata: WindowsExecutableMetadata) {
  if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== ".exe") {
    throw new Error("O executável de inicialização não possui um caminho absoluto válido.");
  }
  if (!/^goliveback(?:[- ].*)?\.exe$/i.test(path.basename(executable))) {
    throw new Error("O launcher de inicialização não foi reconhecido como GoLiveBack.");
  }
  if (path.resolve(metadata.path).toLowerCase() !== path.resolve(executable).toLowerCase()) {
    throw new Error("O inspetor retornou metadados de outro executável.");
  }
  const identity = [metadata.productName, metadata.fileDescription, metadata.companyName].filter(Boolean).join(" ");
  if (!/go\s*live\s*back/i.test(identity)) throw new Error("Os metadados do launcher não pertencem ao GoLiveBack.");
  if (metadata.signatureStatus.toLowerCase() !== "valid" || !metadata.signerSubject) {
    throw new Error("A inicialização automática exige uma build oficial assinada do GoLiveBack.");
  }
}

export async function resolveValidatedStartupCommand(options: {
  portableExecutable?: string;
  processExecutable: string;
  appPath: string;
  packaged: boolean;
}, inspector: StartupExecutableInspector): Promise<StartupCommand> {
  const command = resolveStartupCommand(options);
  if (!options.packaged) return command;

  const launcherMetadata = await inspector(command.executable);
  assertGoLiveBackExecutable(command.executable, launcherMetadata);
  const sameExecutable = path.resolve(command.executable).toLowerCase() === path.resolve(options.processExecutable).toLowerCase();
  const runtimeMetadata = sameExecutable ? launcherMetadata : await inspector(options.processExecutable);
  assertGoLiveBackExecutable(options.processExecutable, runtimeMetadata);
  if (launcherMetadata.signerSubject?.trim().toLowerCase() !== runtimeMetadata.signerSubject?.trim().toLowerCase()) {
    throw new Error("O launcher portátil e o runtime foram assinados por publicadores diferentes.");
  }
  return command;
}
