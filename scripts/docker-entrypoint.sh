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
    # Supervise BOTH children — do not exec into one of them.
    #
    # This used to be `serve-mcp.sh &` followed by `exec scripts/serve.sh`, and
    # exec replaced this shell. Two things followed from that: nothing was left
    # to reap the MCP process (it died and became a zombie, observed in prod on
    # 2026-08-11), and the container only ever exited when the EDITOR died, so a
    # dead MCP server was invisible to Docker's restart policy. The EXIT trap
    # was discarded by the same exec, so it never fired either.
    #
    # Now: both run as children, we block until EITHER exits, then take the
    # container down with a non-zero status. `restart: unless-stopped` turns
    # that into an automatic recovery — one dead service restarts the pair.
    scripts/serve-mcp.sh &
    MCP_PID=$!
    scripts/serve.sh &
    UI_PID=$!

    shutdown() {
      trap - INT TERM
      kill -TERM "${MCP_PID}" "${UI_PID}" 2>/dev/null || true
      wait "${MCP_PID}" "${UI_PID}" 2>/dev/null || true
    }
    trap 'shutdown; exit 0' INT TERM

    # wait -n returns as soon as the first child exits (bash 4.3+).
    set +e
    wait -n
    FIRST_STATUS=$?
    set -e

    if kill -0 "${MCP_PID}" 2>/dev/null; then
      DEAD="editor (:${PORT:-4173})"
    else
      DEAD="MCP HTTP API (:${FOLIO_PORT:-3333})"
    fi
    echo "[entrypoint] ${DEAD} exited (status ${FIRST_STATUS}) — stopping the container so it restarts" >&2
    shutdown
    exit 1
    ;;
  *)
    echo "[entrypoint] Unknown FOLIO_MODE='${MODE}' (expected: ui · mcp · both)" >&2
    exit 1
    ;;
esac
