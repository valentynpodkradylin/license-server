$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed or is not available in PATH."
}

Push-Location $PSScriptRoot
try {
    node proxy.mjs
} finally {
    Pop-Location
}
