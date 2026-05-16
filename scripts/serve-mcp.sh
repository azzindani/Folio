#!/usr/bin/env bash
# serve-mcp.sh — Run the Folio MCP HTTP server.
#
# Endpoints (when FOLIO_API_KEY is set, send Authorization: Bearer <key>):
#   POST /mcp        — JSON-RPC (initialize · tools/list · tools/call)
#   GET  /mcp/sse    — server-sent events
#   GET  /health     — liveness probe
#
# Used by Anthropic MCP connectors / Custom Connectors.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FOLIO_PORT="${FOLIO_PORT:-3333}"

cd "${INSTALL_DIR}"

if [ ! -f "src/mcp/http-server.ts" ]; then
  echo "[serve-mcp] src/mcp/http-server.ts missing — make sure the image was built with src/ copied in." >&2
  exit 1
fi

echo "[serve-mcp] Folio MCP HTTP on :${FOLIO_PORT} (POST /mcp · GET /mcp/sse · GET /health)"
exec node --loader ts-node/esm src/mcp/http-server.ts
