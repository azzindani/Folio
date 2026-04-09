#!/usr/bin/env bash
# build.sh — Build Folio for production
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

log()     { echo -e "${BLUE}[build]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }

cd "${INSTALL_DIR}"

log "Type checking..."
npm run typecheck

log "Linting..."
npm run lint

log "Building production bundle..."
npm run build

success "Build complete → dist/"
