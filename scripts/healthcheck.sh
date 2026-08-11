#!/usr/bin/env bash
# healthcheck.sh — container liveness, aware of which services this mode runs.
#
# The previous check was a single OR across both ports:
#
#   curl :4173/ || curl :3333/health || exit 1
#
# which reports HEALTHY whenever *either* service answers. In FOLIO_MODE=both
# that is exactly backwards: the MCP server can be dead for hours and the
# editor alone keeps the container looking fine. That happened — the outage was
# only caught because the editor answers 401 and `curl -f` counts 401 as a
# failure, so both halves failed by luck rather than by design.
#
# Every service the mode is supposed to be running must answer. No OR.
set -uo pipefail

UI_PORT="${PORT:-4173}"
MCP_PORT="${FOLIO_PORT:-3333}"
MODE="${FOLIO_MODE:-ui}"

# The editor requires auth, so `/` legitimately answers 401. `-f` would call
# that a failure — what we are asking is "did the server answer at all", which
# means no -f here. A dead port fails on the connection instead (curl exit 7).
check_ui() {
  curl -sS -o /dev/null --max-time 4 "http://127.0.0.1:${UI_PORT}/"
}

# /health is unauthenticated and returns JSON, so it must really be 2xx.
check_mcp() {
  curl -fsS -o /dev/null --max-time 4 "http://127.0.0.1:${MCP_PORT}/health"
}

case "${MODE}" in
  ui)  check_ui || { echo "[health] editor :${UI_PORT} not answering" >&2; exit 1; } ;;
  mcp) check_mcp || { echo "[health] MCP :${MCP_PORT} not answering" >&2; exit 1; } ;;
  *)
    rc=0
    check_ui  || { echo "[health] editor :${UI_PORT} not answering" >&2; rc=1; }
    check_mcp || { echo "[health] MCP :${MCP_PORT} not answering" >&2; rc=1; }
    exit "${rc}"
    ;;
esac
