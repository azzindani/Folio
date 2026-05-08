#!/usr/bin/env bash
# serve.sh — Run the Folio preview server (production bundle).
# Used both locally (after build.sh) and as the Docker runtime entry point.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
HOST="${HOST:-0.0.0.0}"

cd "${INSTALL_DIR}"

if [ ! -d "dist" ]; then
  echo "[serve] dist/ not found — run scripts/build.sh first." >&2
  exit 1
fi

echo "[serve] Vite preview on http://${HOST}:${PORT}"
exec npx vite preview --host "${HOST}" --port "${PORT}"
