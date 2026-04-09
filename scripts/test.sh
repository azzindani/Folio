#!/usr/bin/env bash
# test.sh — Run the full Folio test suite
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'

log()     { echo -e "${BLUE}[test]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
fail()    { echo -e "${RED}[fail]${NC} $1"; exit 1; }

cd "${INSTALL_DIR}"

# ── Unit tests ─────────────────────────────────────────────────
log "Running unit tests..."
npm run test:unit -- --coverage || fail "Unit tests failed"
success "Unit tests passed"

# ── Integration tests ──────────────────────────────────────────
log "Running integration tests..."
npm run test:integration || fail "Integration tests failed"
success "Integration tests passed"

# ── E2E tests (requires build) ─────────────────────────────────
if [ "${1:-}" = "--e2e" ]; then
  log "Building for E2E..."
  npm run build

  log "Running E2E tests..."
  npm run test:e2e || fail "E2E tests failed"
  success "E2E tests passed"

  log "Running visual regression tests..."
  npm run test:visual || fail "Visual regression tests failed"
  success "Visual regression tests passed"
fi

success "All tests passed"
