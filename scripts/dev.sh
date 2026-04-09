#!/usr/bin/env bash
# dev.sh — Start the Folio development server
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "${INSTALL_DIR}/node_modules" ]; then
  echo "[dev] node_modules not found. Running npm install..."
  cd "${INSTALL_DIR}" && npm install
fi

echo "[dev] Starting Vite dev server..."
cd "${INSTALL_DIR}" && npm run dev
