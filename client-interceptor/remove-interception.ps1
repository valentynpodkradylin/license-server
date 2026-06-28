$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from PowerShell as Administrator."
}

$marker = "# OHFlightBuilder client interceptor"
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$outputDirectory = Join-Path $PSScriptRoot ".local-proxy"
$domainPath = Join-Path $outputDirectory "domain.txt"
$domain = if (Test-Path $domainPath) {
    (Get-Content $domainPath -Raw).Trim()
} else {
    "plugin-license.vercel.app"
}

$hostsLines = Get-Content $hostsPath
$filteredLines = $hostsLines | Where-Object {
    $_ -notmatch ("^\s*127\.0\.0\.1\s+" + [regex]::Escape($domain) + "(\s|$)") -and
    $_ -ne $marker
}
Set-Content $hostsPath $filteredLines -Encoding ASCII

$thumbprintPath = Join-Path $outputDirectory "cert-thumbprint.txt"
if (Test-Path $thumbprintPath) {
    $thumbprint = (Get-Content $thumbprintPath -Raw).Trim()
    if ($thumbprint) {
        Remove-Item "Cert:\LocalMachine\My\$thumbprint" -ErrorAction SilentlyContinue
        Remove-Item "Cert:\LocalMachine\Root\$thumbprint" -ErrorAction SilentlyContinue
    }
}
if (Test-Path $outputDirectory) {
    Remove-Item -LiteralPath $outputDirectory -Recurse -Force
}

Clear-DnsClientCache
Write-Host "Interceptor removed."
