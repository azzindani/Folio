#!/usr/bin/env bash
# release.sh — Bump version, tag, and push to trigger the release pipeline
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()     { echo -e "${BLUE}[release]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
fail()    { echo -e "${RED}[error]${NC} $1"; exit 1; }

cd "${INSTALL_DIR}"

# ── Require bump type argument ──────────────────────────────────
BUMP="${1:-}"
if [[ ! "${BUMP}" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: bash scripts/release.sh [patch|minor|major]"
  exit 1
fi

# ── Ensure clean working tree ───────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  fail "Working tree is dirty. Commit or stash changes first."
fi

# ── Run full test suite ─────────────────────────────────────────
log "Running tests before release..."
npm run test || fail "Tests failed. Fix before releasing."
npm run typecheck || fail "Type check failed."
npm run lint || fail "Lint failed."

# ── Bump version in package.json ───────────────────────────────
log "Bumping ${BUMP} version..."
npm version "${BUMP}" --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")
log "New version: v${NEW_VERSION}"

# ── Update CHANGELOG.md ────────────────────────────────────────
TODAY=$(date +%Y-%m-%d)
if grep -q "\[Unreleased\]" CHANGELOG.md 2>/dev/null; then
  sed -i "s/\[Unreleased\]/[${NEW_VERSION}] - ${TODAY}/" CHANGELOG.md
  warn "Updated CHANGELOG.md — review and adjust if needed."
fi

# ── Commit, tag, push ───────────────────────────────────────────
git add package.json CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

log "Pushing to origin..."
git push origin main
git push origin "v${NEW_VERSION}"

success "Released v${NEW_VERSION}. CI/CD release pipeline is now running."
