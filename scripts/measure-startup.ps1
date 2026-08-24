param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [ValidateRange(1, 10)]
  [int]$Trials = 3,
  [ValidateRange(5, 120)]
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$measurementRoot = Join-Path $repositoryRoot ".startup-measurement"
$resolvedMeasurementRoot = [System.IO.Path]::GetFullPath($measurementRoot)
if ([System.IO.Path]::GetDirectoryName($resolvedMeasurementRoot) -ne $repositoryRoot) {
  throw "Refusing to use an unexpected startup measurement directory."
}

New-Item -ItemType Directory -Force -Path $resolvedMeasurementRoot | Out-Null
$baselineIds = @(Get-Process GoLiveBack -ErrorAction SilentlyContinue | ForEach-Object Id)
$results = @()

try {
  for ($trial = 1; $trial -le $Trials; $trial += 1) {
    $profile = Join-Path $resolvedMeasurementRoot "profile"
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $startedAt = Get-Date
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $launcher = Start-Process -FilePath $resolvedExecutable -ArgumentList @("--user-data-dir=$profile") -PassThru
    $measuredProcesses = @()
    $windowProcess = $null

    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
      $measuredProcesses = @(Get-Process GoLiveBack -ErrorAction SilentlyContinue | Where-Object {
        $baselineIds -notcontains $_.Id -and $_.StartTime -ge $startedAt.AddSeconds(-1)
      })
      $windowProcess = $measuredProcesses | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
      if ($windowProcess) { break }
      Start-Sleep -Milliseconds 25
    }

    $stopwatch.Stop()
    if (-not $windowProcess) {
      throw "GoLiveBack did not expose its main window within $TimeoutSeconds seconds."
    }
    $workingSetBytes = ($measuredProcesses | Measure-Object WorkingSet64 -Sum).Sum
    $results += [pscustomobject]@{
      Trial = $trial
      Kind = $(if ($trial -eq 1) { "cold" } else { "warm" })
      WindowReadyMs = $stopwatch.ElapsedMilliseconds
      ProcessCount = $measuredProcesses.Count
      WorkingSetMiB = [math]::Round($workingSetBytes / 1MB, 2)
    }

    $measuredProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $launcher.HasExited) { $launcher | Stop-Process -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }
} finally {
  $remaining = @(Get-Process GoLiveBack -ErrorAction SilentlyContinue | Where-Object { $baselineIds -notcontains $_.Id })
  $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $resolvedMeasurementRoot) {
    Remove-Item -LiteralPath $resolvedMeasurementRoot -Recurse -Force
  }
}

$results | ConvertTo-Json
