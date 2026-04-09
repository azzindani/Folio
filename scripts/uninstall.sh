#!/usr/bin/env bash
# uninstall.sh — Clean removal of Folio Design Engine
set -euo pipefail

INSTALL_DIR="${HOME}/.design-engine"
LAUNCHER="/usr/local/bin/design-engine"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }

echo ""
echo -e "${RED}This will remove Folio Design Engine from your system.${NC}"
echo "Your project files in personal folders will NOT be deleted."
echo ""
read -r -p "Continue? (y/N): " confirm
if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
  echo "Uninstall cancelled."
  exit 0
fi

# Remove installation directory
if [ -d "${INSTALL_DIR}" ]; then
  rm -rf "${INSTALL_DIR}"
  success "Removed ${INSTALL_DIR}"
else
  warn "Installation directory not found: ${INSTALL_DIR}"
fi

# Remove launcher
if [ -f "${LAUNCHER}" ]; then
  rm -f "${LAUNCHER}" 2>/dev/null || sudo rm -f "${LAUNCHER}"
  success "Removed launcher: design-engine"
else
  warn "Launcher not found: ${LAUNCHER}"
fi

success "Folio Design Engine uninstalled."
echo "Your project YAML files are untouched."
