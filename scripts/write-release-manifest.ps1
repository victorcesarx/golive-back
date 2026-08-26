[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
$resolvedDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifestPath = Join-Path $resolvedDirectory "release-manifest.json"
$checksumsPath = Join-Path $resolvedDirectory "SHA256SUMS.txt"

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '')
  }
  finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$artifacts = Get-ChildItem -LiteralPath $resolvedDirectory -File |
  Where-Object {
    $_.Name -ne "release-manifest.json" -and
    $_.Name -ne "release-manifest.sig" -and
    $_.Name -ne "SHA256SUMS.txt" -and
    ($_.Extension -in ".exe", ".blockmap" -or
      $_.Name -eq "latest.yml" -or
      $_.Name -eq "bom.cdx.json" -or
      $_.Name -eq "build-metrics.json" -or
      $_.Name -eq "THIRD-PARTY-LICENSES.json")
  } |
  Sort-Object Name

if (-not $artifacts) {
  throw "Nenhum artefato de release foi encontrado em '$resolvedDirectory'."
}

$entries = @(
  foreach ($artifact in $artifacts) {
    $hash = Get-Sha256 $artifact.FullName
    [ordered]@{
      file = $artifact.Name
      bytes = $artifact.Length
      sha256 = $hash
    }
  }
)

$checksumLines = $entries | ForEach-Object { "{0} *{1}" -f $_.sha256, $_.file }
Set-Content -LiteralPath $checksumsPath -Value $checksumLines -Encoding ascii

$packageJson = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
$manifest = [ordered]@{
  application = "GoLiveBack"
  version = $packageJson.version
  commit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { $null }
  artifacts = @($entries)
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, $utf8WithoutBom)

Write-Host "Manifesto criado para $($entries.Count) artefato(s): $checksumsPath"
