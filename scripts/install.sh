#!/usr/bin/env bash
# install.sh — Design Engine installer for Mac and Linux
set -euo pipefail

REQUIRED_NODE="18"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${BLUE}[install]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; exit 1; }

# Check Node.js
if ! command -v node &> /dev/null; then
  error "Node.js not found. Install Node.js ${REQUIRED_NODE}+ from https://nodejs.org"
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "${NODE_VERSION}" -lt "${REQUIRED_NODE}" ]; then
  error "Node.js ${NODE_VERSION} found. Requires ${REQUIRED_NODE}+."
fi
success "Node.js ${NODE_VERSION} found"

# Check npm
if ! command -v npm &> /dev/null; then
  error "npm not found. Reinstall Node.js from https://nodejs.org"
fi
success "npm $(npm --version) found"

# Install dependencies
log "Installing dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install
success "Dependencies installed"

# Build
log "Building production bundle..."
npm run build
success "Build complete"

echo ""
echo -e "${GREEN}Design Engine installed successfully!${NC}"
echo -e "  Dev:   ${BLUE}npm run dev${NC}"
echo -e "  Test:  ${BLUE}npm test${NC}"
echo -e "  Build: ${BLUE}npm run build${NC}"
echo ""
