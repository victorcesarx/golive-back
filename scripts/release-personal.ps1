[CmdletBinding()]
param(
  [string]$OutputDirectory = "release\personal"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$absoluteOutput = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
if (-not $absoluteOutput.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "A pasta de release deve permanecer dentro de '$releaseRoot'."
}
if (Test-Path -LiteralPath $absoluteOutput) {
  $existingFiles = Get-ChildItem -LiteralPath $absoluteOutput -Force -ErrorAction SilentlyContinue
  if ($existingFiles) { throw "A pasta '$absoluteOutput' ja contem arquivos. Use uma pasta vazia para evitar misturar releases." }
}

Push-Location $projectRoot
try {
  & pnpm security:check
  if ($LASTEXITCODE -ne 0) { throw "As verificacoes de seguranca falharam; release cancelada." }

  & pnpm exec electron-builder --win nsis --x64 "--config.forceCodeSigning=false" "--config.directories.output=$OutputDirectory"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento do instalador pessoal falhou." }

  $portableStageDirectory = "$OutputDirectory-portable-stage"
  $absolutePortableStage = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $portableStageDirectory))
  if (-not $absolutePortableStage.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "A pasta temporaria do portatil deve permanecer dentro de '$releaseRoot'."
  }
  if (Test-Path -LiteralPath $absolutePortableStage) { throw "A pasta temporaria '$absolutePortableStage' ja existe." }
  & pnpm exec electron-builder --win portable --x64 "--config.forceCodeSigning=false" "--config.directories.output=$portableStageDirectory"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento portatil pessoal falhou." }
  $stagedPortable = Get-ChildItem -LiteralPath $absolutePortableStage -File -Filter "GoLiveBack-Portable-*.exe"
  if ($stagedPortable.Count -ne 1) { throw "A etapa portatil nao produziu exatamente um executavel." }
  Copy-Item -LiteralPath $stagedPortable.FullName -Destination $absoluteOutput
  Remove-Item -LiteralPath $absolutePortableStage -Recurse -Force

  & pnpm compliance -- $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel gerar os artefatos de conformidade." }
  & pnpm metrics:build -- $absoluteOutput --enforce
  if ($LASTEXITCODE -ne 0) { throw "A release excedeu o orcamento de tamanho ou nao gerou metricas." }
  foreach ($buildIntermediate in @("win-unpacked", "builder-debug.yml", "builder-effective-config.yaml")) {
    $intermediatePath = Join-Path $absoluteOutput $buildIntermediate
    if (Test-Path -LiteralPath $intermediatePath) { Remove-Item -LiteralPath $intermediatePath -Recurse -Force }
  }
  & (Join-Path $PSScriptRoot "write-release-manifest.ps1") -ReleaseDirectory $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel gerar o manifesto da release." }
  & node (Join-Path $PSScriptRoot "sign-update-manifest.mjs") $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel assinar o manifesto de atualizacao." }
  & node (Join-Path $PSScriptRoot "verify-update-release.mjs") $absoluteOutput
  if ($LASTEXITCODE -ne 0) { throw "A verificacao criptografica da release falhou." }

  Write-Host "Release pessoal criada e assinada em '$absoluteOutput'."
  Write-Host "Publique todos os arquivos da pasta como assets da mesma release do GitHub."
}
finally {
  Pop-Location
}
