[CmdletBinding()]
param(
  [string]$OutputDirectory = "release\official"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$absoluteOutput = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
if (-not $absoluteOutput.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "A pasta de release deve permanecer dentro de '$releaseRoot'."
}

foreach ($requiredVariable in "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "GOLIVEBACK_CERTIFICATE_THUMBPRINT") {
  if (-not [Environment]::GetEnvironmentVariable($requiredVariable)) {
    throw "Release oficial bloqueada: a variavel $requiredVariable nao esta configurada."
  }
}

if (Test-Path -LiteralPath $absoluteOutput) {
  $existingFiles = Get-ChildItem -LiteralPath $absoluteOutput -Force -ErrorAction SilentlyContinue
  if ($existingFiles) {
    throw "A pasta '$absoluteOutput' ja contem arquivos. Use uma pasta de saida vazia para evitar misturar releases."
  }
}

Push-Location $projectRoot
try {
  & pnpm security:check
  if ($LASTEXITCODE -ne 0) { throw "As verificacoes continuas de seguranca falharam; release cancelada." }

  & pnpm exec electron-builder --win nsis --x64 "--config.forceCodeSigning=true" "--config.directories.output=$OutputDirectory"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento assinado do instalador falhou." }

  $portableStageDirectory = "$OutputDirectory-portable-stage"
  $absolutePortableStage = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $portableStageDirectory))
  if (-not $absolutePortableStage.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "A pasta temporaria do portatil deve permanecer dentro de '$releaseRoot'."
  }
  if (Test-Path -LiteralPath $absolutePortableStage) {
    throw "A pasta temporaria '$absolutePortableStage' ja existe; remova-a antes de gerar a release."
  }
  & pnpm exec electron-builder --win portable --x64 "--config.forceCodeSigning=true" "--config.directories.output=$portableStageDirectory"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento assinado do portatil falhou." }
  $stagedPortable = Get-ChildItem -LiteralPath $absolutePortableStage -File -Filter "GoLiveBack-Portable-*.exe"
  if ($stagedPortable.Count -ne 1) { throw "A etapa portatil nao produziu exatamente um executavel." }
  Copy-Item -LiteralPath $stagedPortable.FullName -Destination $absoluteOutput
  Remove-Item -LiteralPath $absolutePortableStage -Recurse -Force

  $setup = Get-ChildItem -LiteralPath $absoluteOutput -File -Filter "GoLiveBack-Setup-*.exe"
  $portable = Get-ChildItem -LiteralPath $absoluteOutput -File -Filter "GoLiveBack-Portable-*.exe"
  if (-not $setup -or -not $portable) {
    throw "A release deve conter um instalador e um executavel portatil."
  }

  & pnpm compliance -- $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel gerar o SBOM e o relatorio de licencas." }

  & pnpm metrics:build -- $absoluteOutput --enforce
  if ($LASTEXITCODE -ne 0) { throw "A release excedeu o orcamento de tamanho ou nao gerou metricas." }

  & (Join-Path $PSScriptRoot "write-release-manifest.ps1") -ReleaseDirectory $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel gerar o manifesto da release." }

  & (Join-Path $PSScriptRoot "verify-release.ps1") -ReleaseDirectory $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "A verificacao final da release falhou." }
}
finally {
  Pop-Location
}
