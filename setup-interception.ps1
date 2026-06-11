$ErrorActionPreference = "Stop"

$domain = "plugin-license.vercel.app"
$marker = "# OHFlightBuilder local license server"
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$outputDirectory = Join-Path $PSScriptRoot ".local-proxy"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from PowerShell as Administrator."
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$existingThumbprintPath = Join-Path $outputDirectory "cert-thumbprint.txt"
if (Test-Path $existingThumbprintPath) {
    $existingThumbprint = (Get-Content $existingThumbprintPath -Raw).Trim()
    if ($existingThumbprint) {
        Remove-Item "Cert:\LocalMachine\My\$existingThumbprint" -ErrorAction SilentlyContinue
        Remove-Item "Cert:\LocalMachine\Root\$existingThumbprint" -ErrorAction SilentlyContinue
    }
}

$certificate = New-SelfSignedCertificate `
    -DnsName $domain `
    -CertStoreLocation "Cert:\LocalMachine\My" `
    -FriendlyName "OHFlightBuilder local interception" `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable

$password = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$pfxPath = Join-Path $outputDirectory "plugin-license.pfx"
$cerPath = Join-Path $outputDirectory "plugin-license.cer"

Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null

Set-Content -Path (Join-Path $outputDirectory "cert-password.txt") -Value $password -NoNewline
Set-Content -Path $existingThumbprintPath -Value $certificate.Thumbprint -NoNewline

$hostsLines = Get-Content $hostsPath
$filteredLines = $hostsLines | Where-Object {
    $_ -notmatch ("^\s*127\.0\.0\.1\s+" + [regex]::Escape($domain) + "(\s|$)") -and
    $_ -ne $marker
}
$updatedHosts = @($filteredLines) + $marker + "127.0.0.1 $domain"
Set-Content -Path $hostsPath -Value $updatedHosts -Encoding ASCII

Clear-DnsClientCache
Write-Host "Configured $domain -> 127.0.0.1 and installed the local TLS certificate."
Write-Host "Start interception with: pnpm start:intercept"
