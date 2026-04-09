#Requires -Version 5.1
# install.ps1 — Folio Design Engine installer for Windows
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REQUIRED_NODE = 18
$INSTALL_DIR   = "$env:USERPROFILE\.design-engine"
$REPO_URL      = "https://github.com/azzindani/Folio"

function Log($msg)     { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Success($msg) { Write-Host "[ok] $msg"      -ForegroundColor Green }
function Warn($msg)    { Write-Host "[warn] $msg"    -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "[error] $msg"   -ForegroundColor Red; exit 1 }

# ── Check Node.js ───────────────────────────────────────────────
try {
    $nodeVer = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if ($nodeVer -lt $REQUIRED_NODE) {
        Fail "Node.js $nodeVer found. Requires $REQUIRED_NODE+. Install from https://nodejs.org"
    }
    Success "Node.js $nodeVer found"
} catch {
    Fail "Node.js not found. Install from https://nodejs.org"
}

# ── Check npm ───────────────────────────────────────────────────
try {
    $npmVer = npm --version
    Success "npm $npmVer found"
} catch {
    Fail "npm not found. Reinstall Node.js from https://nodejs.org"
}

# ── Check Git ───────────────────────────────────────────────────
try {
    git --version | Out-Null
    Success "Git found"
} catch {
    Fail "Git not found. Install from https://git-scm.com"
}

# ── Clone or update repo ────────────────────────────────────────
if (Test-Path $INSTALL_DIR) {
    Warn "Existing installation found at $INSTALL_DIR. Updating..."
    Set-Location $INSTALL_DIR
    git pull origin main
} else {
    Log "Installing to $INSTALL_DIR..."
    git clone $REPO_URL $INSTALL_DIR
    Set-Location $INSTALL_DIR
}

# ── Install dependencies ────────────────────────────────────────
Log "Installing dependencies (this may take a minute)..."
$npmCiResult = Start-Process npm -ArgumentList "ci", "--prefer-offline" -Wait -PassThru -NoNewWindow
if ($npmCiResult.ExitCode -ne 0) {
    npm install
}
Success "Dependencies installed"

# ── Build production bundle ─────────────────────────────────────
Log "Building production bundle..."
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed" }
Success "Build complete"

# ── Install Playwright browsers (optional) ──────────────────────
if ($args -contains "--with-tests") {
    Log "Installing Playwright browsers..."
    npx playwright install chromium firefox webkit
    Success "Playwright browsers installed"
}

# ── Create launcher script ──────────────────────────────────────
$launcherDir = "$env:USERPROFILE\AppData\Local\Microsoft\WindowsApps"
$launcherContent = "@echo off`r`ncd /d `"$INSTALL_DIR`" && npm run preview -- --open"
$launcherPath = Join-Path $launcherDir "design-engine.cmd"

try {
    Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
    Success "Launcher installed: design-engine"
} catch {
    Warn "Could not install launcher to PATH. Run manually: cd $INSTALL_DIR && npm run preview"
}

# ── Health check ────────────────────────────────────────────────
Log "Running health check..."
$checks = @(
    @{ Name = "Installation directory"; Test = { Test-Path $INSTALL_DIR } },
    @{ Name = "node_modules present";   Test = { Test-Path "$INSTALL_DIR\node_modules" } },
    @{ Name = "dist/ build present";    Test = { Test-Path "$INSTALL_DIR\dist" } },
    @{ Name = "index.html built";       Test = { Test-Path "$INSTALL_DIR\dist\index.html" } }
)

$pass = 0; $fail = 0
foreach ($check in $checks) {
    if (& $check.Test) {
        Write-Host "  $(([char]0x2713)) $($check.Name)" -ForegroundColor Green
        $pass++
    } else {
        Write-Host "  $(([char]0x2717)) $($check.Name)" -ForegroundColor Red
        $fail++
    }
}

Write-Host ""
Write-Host "  Passed: $pass | Failed: $fail"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Folio Design Engine installed!         " -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Start:   " -NoNewline; Write-Host "design-engine" -ForegroundColor Cyan
Write-Host "  Dev:     " -NoNewline; Write-Host "cd $INSTALL_DIR; npm run dev" -ForegroundColor Cyan
Write-Host "  Test:    " -NoNewline; Write-Host "cd $INSTALL_DIR; npm test" -ForegroundColor Cyan
Write-Host ""
