# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Folio Design Engine — production container.
#
# Assumes a plain OS image (debian:bookworm-slim) with NO pre-installed deps.
# Each stage installs Node from NodeSource, then defers all project work to
# the existing shell scripts under ./scripts so docker and bare-metal builds
# stay in sync.
#
#   build  → scripts/build.sh   (typecheck · lint · vite build)
#   serve  → scripts/serve.sh   (vite preview, host 0.0.0.0)
#
# Build:   docker build -t folio:latest .
# Run:     docker run --rm -p 4173:4173 folio:latest
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20
ARG DEBIAN_BASE=debian:bookworm-slim

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

# Project sources + scripts.
COPY tsconfig.json vite.config.ts eslint.config.js index.html ./
COPY src ./src
COPY scripts ./scripts
RUN chmod +x scripts/*.sh

# Reuse the existing build script (typecheck + lint + vite build).
RUN scripts/build.sh

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM ${DEBIAN_BASE} AS runtime

ARG NODE_VERSION
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0

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

# Copy build output + the runtime deps `vite preview` needs.
COPY --from=builder --chown=folio:folio /app/dist           ./dist
COPY --from=builder --chown=folio:folio /app/node_modules   ./node_modules
COPY --from=builder --chown=folio:folio /app/package.json   ./package.json
COPY --from=builder --chown=folio:folio /app/vite.config.ts ./vite.config.ts
COPY --from=builder --chown=folio:folio /app/index.html     ./index.html
COPY --chown=folio:folio scripts/serve.sh ./scripts/serve.sh
RUN chmod +x scripts/serve.sh

USER folio
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["scripts/serve.sh"]
