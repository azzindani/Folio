#!/usr/bin/env bash
# docker-entrypoint.sh — dispatch container roles via $FOLIO_MODE.
#
#   FOLIO_MODE=ui    (default)  serve.sh        → :4173 editor UI
#   FOLIO_MODE=mcp              serve-mcp.sh    → :3333 MCP HTTP API
#   FOLIO_MODE=both             both, MCP in bg → :4173 + :3333
#
# Custom command? Pass it as argv and we exec it instead.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${INSTALL_DIR}"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# Make the projects dir if it doesn't exist (covers fresh volumes).
PROJECTS_DIR="${FOLIO_PROJECTS_DIR:-/home/folio/projects}"
mkdir -p "${PROJECTS_DIR}" 2>/dev/null || true

MOUNT_KIND="ephemeral (image layer — mount a volume to persist)"
if mountpoint -q "${PROJECTS_DIR}" 2>/dev/null; then
  MOUNT_KIND="persistent (mounted volume)"
fi
echo "[entrypoint] FOLIO_PROJECTS_DIR=${PROJECTS_DIR} — ${MOUNT_KIND}"

MODE="${FOLIO_MODE:-ui}"
case "${MODE}" in
  ui)
    exec scripts/serve.sh
    ;;
  mcp)
    exec scripts/serve-mcp.sh
    ;;
  both)
    scripts/serve-mcp.sh &
    MCP_PID=$!
    trap 'kill -TERM "${MCP_PID}" 2>/dev/null || true' INT TERM EXIT
    exec scripts/serve.sh
    ;;
  *)
    echo "[entrypoint] Unknown FOLIO_MODE='${MODE}' (expected: ui · mcp · both)" >&2
    exit 1
    ;;
esac
