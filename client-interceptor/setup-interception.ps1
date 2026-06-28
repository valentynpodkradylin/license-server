$ErrorActionPreference = "Stop"

$config = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw | ConvertFrom-Json
$domain = [string]$config.interceptDomain
$upstream = [System.Uri][string]$config.upstreamUrl
if (-not $domain -or $upstream.Scheme -ne "https" -or $domain -eq $upstream.Host) {
    throw "Invalid config.json."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from PowerShell as Administrator."
}

$marker = "# OHFlightBuilder client interceptor"
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$outputDirectory = Join-Path $PSScriptRoot ".local-proxy"
$domainPath = Join-Path $outputDirectory "domain.txt"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$previousDomain = if (Test-Path $domainPath) {
    (Get-Content $domainPath -Raw).Trim()
} else {
    $null
}
$thumbprintPath = Join-Path $outputDirectory "cert-thumbprint.txt"
if (Test-Path $thumbprintPath) {
    $oldThumbprint = (Get-Content $thumbprintPath -Raw).Trim()
    if ($oldThumbprint) {
        Remove-Item "Cert:\LocalMachine\My\$oldThumbprint" -ErrorAction SilentlyContinue
        Remove-Item "Cert:\LocalMachine\Root\$oldThumbprint" -ErrorAction SilentlyContinue
    }
}

$certificate = New-SelfSignedCertificate `
    -DnsName $domain `
    -CertStoreLocation "Cert:\LocalMachine\My" `
    -FriendlyName "OHFlightBuilder client interceptor" `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable

$password = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$pfxPath = Join-Path $outputDirectory "interceptor.pfx"
$cerPath = Join-Path $outputDirectory "interceptor.cer"
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null

Set-Content (Join-Path $outputDirectory "cert-password.txt") $password -NoNewline
Set-Content $thumbprintPath $certificate.Thumbprint -NoNewline
Set-Content $domainPath $domain -NoNewline

$domainsToRemove = @($domain, $previousDomain) | Where-Object { $_ } | Select-Object -Unique
$hostsLines = Get-Content $hostsPath
$filteredLines = $hostsLines | Where-Object {
    $line = $_
    -not ($domainsToRemove | Where-Object {
        $line -match ("^\s*127\.0\.0\.1\s+" + [regex]::Escape($_) + "(\s|$)")
    }) -and $line -ne $marker
}
Set-Content $hostsPath (@($filteredLines) + $marker + "127.0.0.1 $domain") -Encoding ASCII
Clear-DnsClientCache

Write-Host "Configured https://$domain -> $($upstream.GetLeftPart('Authority'))"
Write-Host "Now run start-interception.ps1."
