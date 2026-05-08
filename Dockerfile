# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Folio Design Engine — production container.
#
# Assumes a plain OS image (debian:bookworm-slim) with NO pre-installed deps.
# Each stage installs Node from NodeSource, then defers all project work to
# the existing shell scripts under ./scripts so docker and bare-metal builds
# stay in sync.
#
#   build  → scripts/build.sh           (typecheck · lint · vite build)
#   test   → scripts/test.sh            (unit + integration; --e2e opt-in)
#   ui     → scripts/serve.sh           (vite preview, :4173)
#   mcp    → scripts/serve-mcp.sh       (MCP HTTP/SSE, :3333)
#   entry  → scripts/docker-entrypoint  (dispatch by $FOLIO_MODE)
#
# Build:                docker build -t folio:latest .
# Skip tests (faster):  docker build --build-arg SKIP_TESTS=1 -t folio:latest .
# Run UI:               docker run --rm -p 4173:4173 folio:latest
# Run MCP HTTP API:     docker run --rm -p 3333:3333 -e FOLIO_MODE=mcp folio:latest
# Run both:             docker run --rm -p 4173:4173 -p 3333:3333 \
#                                   -e FOLIO_MODE=both folio:latest
# With auth:            -e FOLIO_API_KEY=secret  (then Authorization: Bearer secret)
#
# Persistence:          Folio stores projects as YAML files (no database).
#                       Mount a host directory or named volume at
#                       /home/folio/projects so designs survive restarts:
#                         -v $PWD/folio-projects:/home/folio/projects
#                       or:
#                         -v folio-data:/home/folio/projects
#                       MCP tools then take project_path=/home/folio/projects/<name>.
#
# Anthropic MCP connector points at:  http://<host>:3333/mcp  (POST, JSON-RPC)
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20
ARG DEBIAN_BASE=debian:bookworm-slim
ARG SKIP_TESTS=0

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM ${DEBIAN_BASE} AS builder

ARG NODE_VERSION
ENV DEBIAN_FRONTEND=noninteractive

# Install only what is needed to fetch + run Node + npm.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg xz-utils \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Lockfile-first: cache npm ci independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Project sources + scripts + test fixtures/configs.
COPY tsconfig.json vite.config.ts eslint.config.js index.html ./
COPY vitest.config.ts vitest.integration.config.ts ./
COPY src ./src
COPY tests ./tests
COPY examples ./examples
COPY docs ./docs
COPY scripts ./scripts
RUN chmod +x scripts/*.sh

# Run the full unit + integration test suite before building. Override
# with --build-arg SKIP_TESTS=1 to skip during fast iteration. (E2E /
# visual tests are opt-in via scripts/test.sh --e2e and require Playwright
# Chromium; not run here by default.)
ARG SKIP_TESTS
RUN if [ "${SKIP_TESTS:-0}" = "1" ]; then \
      echo "[docker] SKIP_TESTS=1 — skipping scripts/test.sh"; \
    else \
      scripts/test.sh; \
    fi

# Reuse the existing build script (typecheck + lint + vite build).
RUN scripts/build.sh

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM ${DEBIAN_BASE} AS runtime

ARG NODE_VERSION
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# Defaults — override per `docker run -e ...`
ENV FOLIO_MODE=ui
ENV PORT=4173
ENV HOST=0.0.0.0
ENV FOLIO_PORT=3333
# All MCP file ops are gated to $HOME or /tmp by src/mcp/engine/utils.ts.
# /home/folio/projects is the canonical persistence point — mount a host
# directory (or a docker volume) here to keep projects across restarts.
ENV FOLIO_PROJECTS_DIR=/home/folio/projects

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged user.
RUN groupadd --system folio \
 && useradd  --system --gid folio --create-home --home-dir /home/folio folio

WORKDIR /app

# Build output for `vite preview`.
COPY --from=builder --chown=folio:folio /app/dist           ./dist
# node_modules carries vite (UI preview) AND ts-node (MCP HTTP runner).
COPY --from=builder --chown=folio:folio /app/node_modules   ./node_modules
COPY --from=builder --chown=folio:folio /app/package.json   ./package.json
COPY --from=builder --chown=folio:folio /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=folio:folio /app/tsconfig.json  ./tsconfig.json
COPY --from=builder --chown=folio:folio /app/vite.config.ts ./vite.config.ts
COPY --from=builder --chown=folio:folio /app/index.html     ./index.html
# MCP HTTP server is TS — copy src/ so ts-node can load it at runtime.
COPY --from=builder --chown=folio:folio /app/src            ./src
COPY --chown=folio:folio scripts/serve.sh             ./scripts/serve.sh
COPY --chown=folio:folio scripts/serve-mcp.sh         ./scripts/serve-mcp.sh
COPY --chown=folio:folio scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x scripts/serve.sh scripts/serve-mcp.sh scripts/docker-entrypoint.sh

# Pre-create + own the projects mount point so an unmounted run still works
# (data goes into the image layer; mount a volume to make it survive).
RUN mkdir -p "${FOLIO_PROJECTS_DIR}" && chown -R folio:folio /home/folio

USER folio
EXPOSE 4173 3333
VOLUME ["/home/folio/projects"]

# Health check probes whichever role is active. UI on :4173, MCP on :3333.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 \
   || curl -fsS "http://127.0.0.1:${FOLIO_PORT}/health" >/dev/null 2>&1 \
   || exit 1

ENTRYPOINT ["scripts/docker-entrypoint.sh"]
