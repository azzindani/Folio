# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Folio Design Engine — production container (Bun base).
#
# Two-stage build on oven/bun:1-alpine. Bun executes TypeScript natively so
# the MCP HTTP server runs with no ts-node loader and no extra runtime deps.
#
#   build    → bun install + scripts/build.sh (typecheck + lint + vite build)
#   runtime  → /app/dist + /app/src + scripts/serve*.sh; entrypoint dispatch
#
# Entrypoints (scripts/docker-entrypoint.sh):
#   FOLIO_MODE=ui    serve.sh        → :4173 visual editor (vite preview)
#   FOLIO_MODE=mcp   serve-mcp.sh    → :3333 MCP HTTP + SSE
#   FOLIO_MODE=both  both, MCP in bg → :4173 + :3333
#
# Build:                docker build -t folio:latest .
# Skip tests (faster):  docker build --build-arg SKIP_TESTS=1 -t folio:latest .
# Run UI:               docker run --rm -p 4173:4173 folio:latest
# Run MCP HTTP API:     docker run --rm -p 3333:3333 -e FOLIO_MODE=mcp folio:latest
# Run both:             docker run --rm -p 4173:4173 -p 3333:3333 \
#                                   -e FOLIO_MODE=both folio:latest
#
# Auth:
#   Single token:   -e FOLIO_API_KEY=secret
#   Multi-token:    -v $PWD/tokens.json:/home/folio/tokens.json:ro \
#                   -e FOLIO_TOKENS_FILE=/home/folio/tokens.json
#   Multi-inline:   -e FOLIO_TOKENS='claude:sk-abc,hermes:sk-def'
#
# Persistence:
#   -v $PWD/folio-projects:/home/folio/projects     # host dir (recommended)
#   -v folio-data:/home/folio/projects              # named volume
# MCP tools take project_path=/home/folio/projects/<name>.
#
# Recommended public deployment: use docker-compose.yml with --profile tls
# to bring up a Caddy sidecar that terminates HTTPS for FOLIO_DOMAIN.
# ─────────────────────────────────────────────────────────────────────────────

ARG BUN_VERSION=1.1.38
ARG SKIP_TESTS=0

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS builder

WORKDIR /app

# Build tooling for native deps in node_modules + curl for healthcheck binary.
# nodejs/npm are required because scripts/build.sh (shared with host dev)
# invokes `npm run typecheck/lint/build`. Bun runs JS at runtime; npm only
# drives the build pipeline here.
RUN apk add --no-cache python3 make g++ git bash curl nodejs npm

# Lockfile-first: cache deps independently of source changes.
# package-lock.json is the source of truth; install npm packages via bun.
COPY package.json package-lock.json bunfig.toml ./
RUN bun install --frozen-lockfile

# Project sources + scripts + test fixtures/configs.
COPY tsconfig.json vite.config.ts eslint.config.js index.html ./
COPY vitest.config.ts vitest.integration.config.ts ./
COPY src ./src
COPY public ./public
COPY tests ./tests
COPY examples ./examples
COPY docs ./docs
COPY scripts ./scripts
# Strip Windows-style CRLF line endings (Git on Windows checks scripts out
# with CRLF by default; Alpine's bash treats the trailing \r as part of the
# next token and breaks `set -euo pipefail`). dos2unix is overkill here —
# `sed` is enough and adds zero deps.
RUN find scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
 && chmod +x scripts/*.sh

# Run the full unit + integration test suite before building. Override
# with --build-arg SKIP_TESTS=1 to skip during fast iteration.
ARG SKIP_TESTS
RUN if [ "${SKIP_TESTS:-0}" = "1" ]; then \
      echo "[docker] SKIP_TESTS=1 — skipping scripts/test.sh"; \
    else \
      bash scripts/test.sh; \
    fi

# Typecheck + lint + vite build via existing script.
RUN bash scripts/build.sh

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS runtime

ENV NODE_ENV=production
# Defaults — override per `docker run -e ...`
ENV FOLIO_MODE=ui
ENV PORT=4173
ENV HOST=0.0.0.0
ENV FOLIO_PORT=3333
# All MCP file ops are gated to $HOME or /tmp by src/mcp/engine/utils.ts.
# /home/folio/projects is the canonical persistence point.
ENV FOLIO_PROJECTS_DIR=/home/folio/projects

# bash for entrypoint scripts, curl for HEALTHCHECK, tini for proper PID 1.
# Bun serves the editor (src/editor/static-server.ts) and the MCP HTTP API
# (src/mcp/http-server.ts) — no node/npm needed at runtime.
RUN apk add --no-cache bash curl tini

# Unprivileged user. The oven/bun image ships a `bun` user/group at uid 1000;
# we add a parallel `folio` user with its own home so paths in docs are stable.
RUN addgroup -S folio \
 && adduser -S -G folio -h /home/folio -s /bin/bash folio

WORKDIR /app

# Build output for `vite preview`.
COPY --from=builder --chown=folio:folio /app/dist          ./dist
# node_modules carries vite (UI preview) AND server-side deps (jsdom, js-yaml, …).
COPY --from=builder --chown=folio:folio /app/node_modules  ./node_modules
COPY --from=builder --chown=folio:folio /app/package.json  ./package.json
COPY --from=builder --chown=folio:folio /app/bunfig.toml   ./bunfig.toml
COPY --from=builder --chown=folio:folio /app/tsconfig.json ./tsconfig.json
# MCP HTTP server runs from src/ — bun executes TS directly, no transpile step.
COPY --from=builder --chown=folio:folio /app/src           ./src
COPY --chown=folio:folio scripts/serve.sh             ./scripts/serve.sh
COPY --chown=folio:folio scripts/serve-mcp.sh         ./scripts/serve-mcp.sh
COPY --chown=folio:folio scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN sed -i 's/\r$//' scripts/serve.sh scripts/serve-mcp.sh scripts/docker-entrypoint.sh \
 && chmod +x scripts/*.sh

# Pre-create + own the projects mount point so an unmounted run still works.
RUN mkdir -p "${FOLIO_PROJECTS_DIR}" && chown -R folio:folio /home/folio

USER folio
EXPOSE 4173 3333
VOLUME ["/home/folio/projects"]

# Delegated to scripts/healthcheck.sh so the Dockerfile and docker-compose.yml
# cannot drift apart. It requires EVERY service the mode runs to answer — the
# old inline OR reported healthy while one half was dead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD scripts/healthcheck.sh || exit 1

ENTRYPOINT ["/sbin/tini", "--", "scripts/docker-entrypoint.sh"]
