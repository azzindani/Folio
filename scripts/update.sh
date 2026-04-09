#!/usr/bin/env bash
# update.sh — Pull latest changes and rebuild
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

log()     { echo -e "${BLUE}[update]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }

cd "${INSTALL_DIR}"

CURRENT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
log "Current version: ${CURRENT}"

log "Pulling latest from origin..."
git pull origin main

LATEST=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [ "${CURRENT}" = "${LATEST}" ]; then
  success "Already up to date (${CURRENT})."
  exit 0
fi

log "Changes detected (${CURRENT} → ${LATEST}). Rebuilding..."
npm ci --prefer-offline 2>/dev/null || npm install
npm run build

bash "${INSTALL_DIR}/scripts/health-check.sh"
success "Updated to ${LATEST}."
