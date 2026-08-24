[CmdletBinding()]
param(
  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot "..\release\official"),
  [string]$ExpectedCertificateThumbprint = $env:GOLIVEBACK_CERTIFICATE_THUMBPRINT
)

$ErrorActionPreference = "Stop"
$resolvedDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$checksumsPath = Join-Path $resolvedDirectory "SHA256SUMS.txt"
$manifestPath = Join-Path $resolvedDirectory "release-manifest.json"

if (-not $ExpectedCertificateThumbprint) {
  throw "Defina GOLIVEBACK_CERTIFICATE_THUMBPRINT com o thumbprint do certificado oficial."
}

if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
  throw "Arquivo SHA256SUMS.txt ausente em '$resolvedDirectory'."
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Arquivo release-manifest.json ausente em '$resolvedDirectory'."
}

$expectedThumbprint = ($ExpectedCertificateThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($expectedThumbprint.Length -ne 40) {
  throw "GOLIVEBACK_CERTIFICATE_THUMBPRINT deve conter um SHA-1 de 40 caracteres hexadecimais."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.artifacts -or $manifest.artifacts.Count -eq 0) {
  throw "O manifesto nao contem artefatos."
}

$releaseArtifacts = Get-ChildItem -LiteralPath $resolvedDirectory -File |
  Where-Object {
    $_.Name -ne "release-manifest.json" -and
    $_.Name -ne "SHA256SUMS.txt" -and
    ($_.Extension -in ".exe", ".blockmap" -or
      $_.Name -eq "latest.yml" -or
      $_.Name -eq "bom.cdx.json" -or
      $_.Name -eq "build-metrics.json" -or
      $_.Name -eq "THIRD-PARTY-LICENSES.json")
  }
$manifestNames = @($manifest.artifacts | ForEach-Object { $_.file })
if ($releaseArtifacts.Count -ne $manifestNames.Count) {
  throw "A lista de artefatos da pasta diverge do manifesto."
}
foreach ($releaseArtifact in $releaseArtifacts) {
  if ($releaseArtifact.Name -notin $manifestNames) {
    throw "Artefato sem hash no manifesto: '$($releaseArtifact.Name)'."
  }
}

$checksumEntries = @{}
foreach ($line in Get-Content -LiteralPath $checksumsPath) {
  if ($line -notmatch '^([0-9A-Fa-f]{64})\s+\*?(.+)$') {
    throw "Linha invalida em SHA256SUMS.txt: '$line'."
  }
  $checksumFileName = $Matches[2]
  if ($checksumEntries.ContainsKey($checksumFileName)) {
    throw "Entrada duplicada em SHA256SUMS.txt: '$checksumFileName'."
  }
  $checksumEntries[$checksumFileName] = $Matches[1].ToUpperInvariant()
}

if ($checksumEntries.Count -ne $manifestNames.Count) {
  throw "A lista de hashes diverge do manifesto."
}

foreach ($entry in $manifest.artifacts) {
  if ([IO.Path]::GetFileName($entry.file) -ne $entry.file) {
    throw "Nome de artefato inseguro no manifesto: '$($entry.file)'."
  }
  $artifactPath = Join-Path $resolvedDirectory $entry.file
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Artefato ausente: '$($entry.file)'."
  }

  $actualHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $entry.sha256.ToUpperInvariant()) {
    throw "SHA-256 divergente no manifesto para '$($entry.file)'."
  }
  if (-not $checksumEntries.ContainsKey($entry.file) -or $actualHash -ne $checksumEntries[$entry.file]) {
    throw "SHA-256 divergente em SHA256SUMS.txt para '$($entry.file)'."
  }
}

$executables = Get-ChildItem -LiteralPath $resolvedDirectory -File -Filter "GoLiveBack-*.exe"
if (-not $executables) {
  throw "Nenhum executavel GoLiveBack foi encontrado para verificar."
}

foreach ($executable in $executables) {
  $executableHash = (Get-FileHash -LiteralPath $executable.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
  $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
    throw "Assinatura Authenticode invalida em '$($executable.Name)': $($signature.Status) $($signature.StatusMessage)"
  }

  $actualThumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  if ($actualThumbprint -ne $expectedThumbprint) {
    throw "Certificado inesperado em '$($executable.Name)'. Esperado: $expectedThumbprint; encontrado: $actualThumbprint."
  }

  if (-not $signature.TimeStamperCertificate) {
    throw "O executavel '$($executable.Name)' nao possui carimbo de tempo Authenticode."
  }

  Write-Host "OK: $($executable.Name) | $executableHash | $($signature.SignerCertificate.Subject)"
}

Write-Host "Release verificada: hashes, certificado e carimbo de tempo validos."
