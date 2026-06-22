# UAVLogBook — Web App Build Script (Windows PowerShell)
# Run: .\build_web.ps1

Write-Host "UAVLogBook - Building Web App" -ForegroundColor Cyan

$webDir = Join-Path $PSScriptRoot "..\web"
Set-Location $webDir

# Check Node.js
try {
    $nodeVer = node --version
    Write-Host "Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Copy .env
if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.example" ".env.local"
    Write-Host ""
    Write-Host "IMPORTANT: Edit web\.env.local and set your API URL" -ForegroundColor Yellow
    Write-Host "Press Enter after editing .env.local..."
    Read-Host
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "Building production bundle..." -ForegroundColor Cyan
npm run build

if (Test-Path "dist") {
    Write-Host ""
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "Upload the contents of web\dist\ to your public_html folder via cPanel File Manager or FTP" -ForegroundColor Yellow
} else {
    Write-Host "Build failed. Check errors above." -ForegroundColor Red
}
