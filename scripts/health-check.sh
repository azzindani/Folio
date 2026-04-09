#!/usr/bin/env bash
# health-check.sh — Verify installation is correct
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0

check() {
  local name="$1"; local cmd="$2"
  if eval "${cmd}" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} ${name}"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} ${name}"
    ((FAIL++))
  fi
}

echo "Health Check:"
check "Node.js 18+"            "node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)'"
check "npm available"          "command -v npm"
check "node_modules present"   "[ -d 'node_modules' ]"
check "dist/ build present"    "[ -d 'dist' ]"
check "index.html built"       "[ -f 'dist/index.html' ]"
check "package.json valid"     "node -e \"require('./package.json')\""
check "TypeScript compiles"    "npx tsc --noEmit"
check "Tests pass"             "npx vitest run"

echo ""
echo "  Passed: ${PASS} | Failed: ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  echo -e "${RED}Health check failed.${NC}"
  exit 1
fi
echo -e "${GREEN}All checks passed.${NC}"
