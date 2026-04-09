#Requires -Version 5.1
# uninstall.ps1 — Clean removal of Folio Design Engine on Windows
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$INSTALL_DIR  = "$env:USERPROFILE\.design-engine"
$LAUNCHER_DIR = "$env:USERPROFILE\AppData\Local\Microsoft\WindowsApps"
$LAUNCHER     = Join-Path $LAUNCHER_DIR "design-engine.cmd"

function Warn($msg)    { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Success($msg) { Write-Host "[ok] $msg"   -ForegroundColor Green }

Write-Host ""
Write-Host "This will remove Folio Design Engine from your system." -ForegroundColor Red
Write-Host "Your project files in personal folders will NOT be deleted."
Write-Host ""
$confirm = Read-Host "Continue? (y/N)"
if ($confirm -notmatch '^[Yy]$') {
    Write-Host "Uninstall cancelled."
    exit 0
}

# Remove installation directory
if (Test-Path $INSTALL_DIR) {
    Remove-Item -Recurse -Force $INSTALL_DIR
    Success "Removed $INSTALL_DIR"
} else {
    Warn "Installation directory not found: $INSTALL_DIR"
}

# Remove launcher
if (Test-Path $LAUNCHER) {
    Remove-Item -Force $LAUNCHER
    Success "Removed launcher: design-engine.cmd"
} else {
    Warn "Launcher not found: $LAUNCHER"
}

Success "Folio Design Engine uninstalled."
Write-Host "Your project YAML files are untouched."
