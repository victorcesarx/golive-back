[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Get-RequiredEnvironmentVariable([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Release oficial bloqueada: a variavel $Name nao esta configurada."
  }
  return $value
}

$certificateLink = Get-RequiredEnvironmentVariable "WIN_CSC_LINK"
$certificatePassword = Get-RequiredEnvironmentVariable "WIN_CSC_KEY_PASSWORD"
$configuredThumbprint = Get-RequiredEnvironmentVariable "GOLIVEBACK_CERTIFICATE_THUMBPRINT"
$expectedThumbprint = ($configuredThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()

if ($expectedThumbprint.Length -ne 40) {
  throw "GOLIVEBACK_CERTIFICATE_THUMBPRINT deve conter um SHA-1 de 40 caracteres hexadecimais."
}

function Assert-CodeSigningCertificate(
  [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
  [string]$ExpectedThumbprint
) {
  if (-not $Certificate.HasPrivateKey) {
    throw "O certificado configurado nao contem uma chave privada."
  }
  if ((Get-Date) -lt $Certificate.NotBefore -or (Get-Date) -gt $Certificate.NotAfter) {
    throw "O certificado configurado esta fora do periodo de validade."
  }
  if ($Certificate.Thumbprint.ToUpperInvariant() -ne $ExpectedThumbprint) {
    throw "O thumbprint do certificado configurado diverge de GOLIVEBACK_CERTIFICATE_THUMBPRINT."
  }

  $codeSigningOid = "1.3.6.1.5.5.7.3.3"
  $ekuExtension = $Certificate.Extensions |
    Where-Object { $_.Oid.Value -eq "2.5.29.37" } |
    Select-Object -First 1
  if (-not $ekuExtension) {
    throw "O certificado configurado nao declara o uso estendido para assinatura de codigo."
  }
  $enhancedKeyUsages = ([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ekuExtension).EnhancedKeyUsages
  if (-not ($enhancedKeyUsages | Where-Object { $_.Value -eq $codeSigningOid })) {
    throw "O certificado configurado nao permite assinatura de codigo."
  }
}

$certificate = $null
$certificateBytes = $null
try {
  $certificateUri = $null
  $isAbsoluteUri = [System.Uri]::TryCreate($certificateLink, [System.UriKind]::Absolute, [ref]$certificateUri)
  if ($isAbsoluteUri -and $certificateUri.Scheme -in "https", "http") {
    if ($certificateUri.Scheme -ne "https") {
      throw "WIN_CSC_LINK remoto deve usar HTTPS."
    }
    Write-Host "Assinatura pronta para empacotamento: URL HTTPS privada e thumbprint configurados."
    Write-Host "A identidade, a assinatura e o carimbo de tempo serao conferidos nos executaveis gerados."
    return
  }

  $certificatePath = if ($isAbsoluteUri -and $certificateUri.IsFile) { $certificateUri.LocalPath } else { $certificateLink }
  $looksLikeCertificatePath = $certificatePath -match '(?i)\.(pfx|p12)$' -or
    $certificatePath -match '^[A-Za-z]:[\\/]' -or
    $certificatePath.StartsWith(".\") -or
    $certificatePath.StartsWith("./")

  if ($looksLikeCertificatePath) {
    if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
      throw "O certificado local informado em WIN_CSC_LINK nao foi encontrado."
    }
    $certificatePath = (Resolve-Path -LiteralPath $certificatePath).Path
    $extension = [System.IO.Path]::GetExtension($certificatePath).ToLowerInvariant()
    if ($extension -notin ".pfx", ".p12") {
      throw "WIN_CSC_LINK local deve apontar para um certificado .pfx ou .p12."
    }
    $certificateSource = "arquivo local"
  }
  else {
    $base64Value = $certificateLink
    if ($certificateLink.StartsWith("data:", [System.StringComparison]::OrdinalIgnoreCase)) {
      if ($certificateLink -notmatch '^data:[^,]*;base64,(.+)$') {
        throw "O data URI em WIN_CSC_LINK nao contem um PFX/P12 em Base64."
      }
      $base64Value = $Matches[1]
    }
    try {
      $certificateBytes = [System.Convert]::FromBase64String($base64Value)
    }
    catch {
      throw "WIN_CSC_LINK deve ser um caminho PFX/P12, uma URL HTTPS ou um PFX/P12 em Base64 valido."
    }
    $certificateSource = "PFX/P12 em Base64"
  }

  $storageFlags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
  if ($certificateBytes) {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
      $certificateBytes,
      $certificatePassword,
      $storageFlags
    )
  }
  else {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
      $certificatePath,
      $certificatePassword,
      $storageFlags
    )
  }

  Assert-CodeSigningCertificate $certificate $expectedThumbprint
  Write-Host "Assinatura pronta: $certificateSource valido, chave privada presente, EKU de code signing e thumbprint conferidos."
  Write-Host "Publicador: $($certificate.Subject)"
  Write-Host "Valido ate: $($certificate.NotAfter.ToString('yyyy-MM-dd'))"
}
finally {
  if ($certificate) { $certificate.Dispose() }
  if ($certificateBytes) { [System.Array]::Clear($certificateBytes, 0, $certificateBytes.Length) }
}
