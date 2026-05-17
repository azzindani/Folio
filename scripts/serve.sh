#!/usr/bin/env bash
# serve.sh — Run the Folio visual editor in production.
#
# In Docker we use Bun's built-in static server (src/editor/static-server.ts)
# so the runtime image doesn't need vite / npm / node. Locally we fall back
# to `npx vite preview` if bun isn't installed.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PORT="${PORT:-4173}"
export HOST="${HOST:-0.0.0.0}"

cd "${INSTALL_DIR}"

if [ ! -d "dist" ]; then
  echo "[serve] dist/ not found — run scripts/build.sh first." >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  echo "[serve] static server on http://${HOST}:${PORT} (bun)"
  exec bun run src/editor/static-server.ts
else
  echo "[serve] static server on http://${HOST}:${PORT} (vite preview fallback)"
  exec npx vite preview --host "${HOST}" --port "${PORT}"
fi
