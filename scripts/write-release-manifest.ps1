[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
$resolvedDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifestPath = Join-Path $resolvedDirectory "release-manifest.json"
$checksumsPath = Join-Path $resolvedDirectory "SHA256SUMS.txt"

$artifacts = Get-ChildItem -LiteralPath $resolvedDirectory -File |
  Where-Object {
    $_.Name -ne "release-manifest.json" -and
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
    $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
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
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Manifesto criado para $($entries.Count) artefato(s): $checksumsPath"
