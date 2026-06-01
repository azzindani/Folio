#!/usr/bin/env bash
# serve-mcp.sh — Run the Folio MCP HTTP server.
#
# Endpoints (when auth is configured, send Authorization: Bearer <token>):
#   POST /mcp            — JSON-RPC (initialize · tools/list · tools/call)
#   GET  /mcp/sse        — server-sent events (all tool responses)
#   GET  /editor/events  — live file-change events for the visual editor
#   GET  /health         — liveness probe (no auth)
#   GET  /tokens/whoami  — return the token name that authenticated this request
#
# Auth modes (any one is enough — checked in this priority order):
#   1. FOLIO_TOKENS_FILE=/path/to/tokens.json    {"name":"sk-...","other":"sk-..."}
#   2. FOLIO_TOKENS="name:sk-...,other:sk-..."   inline named tokens
#   3. FOLIO_API_KEY="sk-..."                    single shared bearer (legacy)
#   (none set → server runs unauthenticated — local-only use)
#
# Used by Anthropic MCP connectors, Claude Code MCP, Hermes, OpenClaw, etc.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FOLIO_PORT="${FOLIO_PORT:-3333}"

cd "${INSTALL_DIR}"

if [ ! -f "src/mcp/http-server.ts" ]; then
  echo "[serve-mcp] src/mcp/http-server.ts missing — make sure the image was built with src/ copied in." >&2
  exit 1
fi

# Prefer bun (native TS execution, ~50ms cold start). Fall back to node + ts-node
# when bun isn't installed (e.g. dev machines without bun).
if command -v bun >/dev/null 2>&1; then
  echo "[serve-mcp] Folio MCP HTTP on :${FOLIO_PORT} (POST /mcp · GET /mcp/sse · GET /editor/events · GET /health)"
  # --smol: smaller heap + more aggressive GC. This server is long-lived in a
  # memory-capped container, so a lower steady-state footprint beats the
  # marginal CPU cost.
  exec bun --smol run src/mcp/http-server.ts
else
  echo "[serve-mcp] Folio MCP HTTP on :${FOLIO_PORT} (node+ts-node fallback)"
  exec node --loader ts-node/esm src/mcp/http-server.ts
fi
