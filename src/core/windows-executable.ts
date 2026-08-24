import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WindowsExecutableMetadata {
  path: string;
  signatureStatus: string;
  signerSubject: string | null;
  productName: string | null;
  fileDescription: string | null;
  companyName: string | null;
  fileVersion: string | null;
}

export interface WindowsProcessReference {
  pid: number;
  executable: string;
}

const INSPECT_EXECUTABLE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
$target = [System.IO.Path]::GetFullPath($env:GOLIVEBACK_EXECUTABLE)
$item = Get-Item -LiteralPath $target
$signature = Get-AuthenticodeSignature -LiteralPath $target
$version = $item.VersionInfo
[pscustomobject]@{
  path = $item.FullName
  signatureStatus = [string]$signature.Status
  signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  productName = $version.ProductName
  fileDescription = $version.FileDescription
  companyName = $version.CompanyName
  fileVersion = $version.FileVersion
} | ConvertTo-Json -Compress
`;

const LIST_PROCESSES_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = [System.IO.Path]::GetFullPath($env:GOLIVEBACK_EXECUTABLE)
$processName = [System.IO.Path]::GetFileNameWithoutExtension($target)
$matches = @(
  Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
    try {
      [string]::Equals([System.IO.Path]::GetFullPath($_.Path), $target, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
      $false
    }
  } | ForEach-Object {
    [pscustomobject]@{ pid = $_.Id; executable = $_.Path }
  }
)
[pscustomobject]@{ processes = $matches } | ConvertTo-Json -Compress -Depth 3
`;

const STOP_PROCESSES_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = [System.IO.Path]::GetFullPath($env:GOLIVEBACK_EXECUTABLE)
$processName = [System.IO.Path]::GetFileNameWithoutExtension($target)
$stopped = @(
  Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
    try {
      [string]::Equals([System.IO.Path]::GetFullPath($_.Path), $target, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
      $false
    }
  } | ForEach-Object {
    $pidToStop = $_.Id
    Stop-Process -InputObject $_ -Force -ErrorAction Stop
    $pidToStop
  }
)
[pscustomobject]@{ pids = $stopped } | ConvertTo-Json -Compress -Depth 3
`;

async function runPowerShellJson<T>(script: string, executable: string, timeout: number): Promise<T> {
  if (process.platform !== "win32") throw new Error("Windows executable inspection is only available on Windows");
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error("Windows system directory was not found");
  const environment: NodeJS.ProcessEnv = { ...process.env, GOLIVEBACK_EXECUTABLE: executable };
  // A process started from PowerShell 7 can carry a PSModulePath that prevents
  // Windows PowerShell 5.1 from loading its own signed system modules.
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "psmodulepath") delete environment[key];
  }
  const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await execFileAsync(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], {
    windowsHide: true,
    timeout,
    maxBuffer: 256 * 1024,
    env: environment
  });
  return JSON.parse(stdout.trim()) as T;
}

export async function inspectWindowsExecutable(executable: string): Promise<WindowsExecutableMetadata> {
  return runPowerShellJson<WindowsExecutableMetadata>(INSPECT_EXECUTABLE_SCRIPT, executable, 10_000);
}

export async function listWindowsProcessesByExecutable(executable: string): Promise<WindowsProcessReference[]> {
  const result = await runPowerShellJson<{ processes?: WindowsProcessReference[] }>(LIST_PROCESSES_SCRIPT, executable, 7_000);
  return Array.isArray(result.processes) ? result.processes : [];
}

export async function stopWindowsProcessesByExecutable(executable: string): Promise<number[]> {
  const result = await runPowerShellJson<{ pids?: number[] }>(STOP_PROCESSES_SCRIPT, executable, 10_000);
  return Array.isArray(result.pids) ? result.pids : [];
}
