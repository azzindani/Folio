# DEPLOYMENT.md — Hosting Folio & Its Endpoints

> How to run Folio for yourself or expose it to remote MCP clients. For *connecting*
> a specific client once it's up, see [INTEGRATIONS.md](INTEGRATIONS.md). For the MCP
> protocol itself see [MCP.md](MCP.md).

---

## 1. PICK A DEPLOYMENT MODE

| Mode | Best for | Transport | Auth | Editor |
|---|---|---|---|---|
| **Local stdio** | One user, model on your machine (LM Studio, local Claude Code) | stdio | none (process-local) | run separately |
| **Local Docker** | One user, everything in one container | HTTP + SSE on `localhost` | optional | bundled `:4173` |
| **VPS Docker (plain HTTP)** | Behind your own nginx / Cloudflare Tunnel | HTTP + SSE on a port | **required** | bundled `:4173` |
| **VPS Docker + Caddy (TLS)** | Public deploy, claude.ai connector, multi-client | HTTPS auto-cert | **required** | `https://your-domain/` |

All modes run the same Folio code. The only difference is transport + auth + TLS.

---

## 2. LOCAL — stdio

The host launches Folio as a subprocess; designs land under `~/.folio/projects/`
(or the dir you point at). No server, no ports, no auth.

```bash
git clone https://github.com/azzindani/Folio.git ~/.folio_mcp
cd ~/.folio_mcp && bun install --frozen-lockfile
FOLIO_MCP_TIER=all bun run src/mcp/index.ts        # smoke test (Ctrl-C to stop)
```

Then register it in your MCP client (`mcp.json`) — see [INTEGRATIONS.md §3](INTEGRATIONS.md).
`FOLIO_MCP_TIER` chooses the surface: `1` (15 tools), `2`, `3`, or `all` (49).

> Node fallback (no Bun): `node --loader ts-node/esm src/mcp/index.ts`.

---

## 3. LOCAL — Docker

One container, editor + MCP HTTP API, on your laptop.

```bash
git clone https://github.com/azzindani/Folio.git && cd Folio
cp .env.example .env
cp tokens.example.json tokens.json    # edit: replace placeholders (or skip for open mode)
docker compose up -d --build
```

| URL | Serves |
|---|---|
| `http://localhost:4173/` | Visual editor |
| `http://localhost:3333/mcp` | MCP JSON-RPC |
| `http://localhost:3333/mcp/sse` | Tool-result SSE |
| `http://localhost:3333/editor/events` | File-change SSE (live editor refresh) |
| `http://localhost:3333/health` | Liveness (no auth) |
| `http://localhost:3333/tokens/whoami` | Which token authenticated |

Designs persist to `./folio-projects` on the host (bind-mounted to
`/home/folio/projects`). `docker compose down` to stop; `up -d` to restart.

---

## 4. VPS — Production with auto-HTTPS (Caddy)

For exposing Folio publicly so claude.ai Custom Connectors, remote Claude Code,
Hermes, OpenClaw, or any MCP-over-HTTP client can reach it.

1. **DNS** — `A` record `folio.your-domain.tld → <vps-ip>`; wait for propagation.
2. **Install** Docker + Compose on the VPS.
3. **Clone & configure:**
   ```bash
   git clone https://github.com/azzindani/Folio.git && cd Folio
   cp .env.example .env
   cp tokens.example.json tokens.json
   ```
4. **Edit `.env`:**
   ```ini
   FOLIO_DOMAIN=folio.your-domain.tld
   FOLIO_ACME_EMAIL=you@your-domain.tld
   FOLIO_MODE=both
   FOLIO_TOKENS_FILE=/home/folio/tokens.json
   # Editor browser login (required by the TLS profile):
   FOLIO_BASIC_USER=admin
   FOLIO_BASIC_HASH=<bcrypt hash, see below>
   ```
5. **Edit `tokens.json`** — replace every placeholder with a long random string
   (`openssl rand -hex 32`). Keep it out of git (`.gitignore` excludes it).
6. **Generate the editor Basic-Auth hash:**
   ```bash
   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-pass'
   # paste into FOLIO_BASIC_HASH; escape every $ as $$ for compose substitution
   ```
7. **Bring it up with TLS:**
   ```bash
   docker compose --profile tls up -d --build
   ```

Caddy requests a Let's Encrypt cert for `FOLIO_DOMAIN` and terminates HTTPS in under
a minute. Confirm:

```bash
curl -fsS https://folio.your-domain.tld/health
# → {"status":"ok","version":"1.0.0","tiers":["1","2","3"],"auth":"multi"}

curl -H "Authorization: Bearer <one-of-your-tokens>" \
     https://folio.your-domain.tld/tokens/whoami
# → {"token":"claude-desktop","auth_mode":"multi"}
```

---

## 5. CONTAINER ARCHITECTURE

The image is `oven/bun` and **runs the MCP server directly from `src/`** (no compiled
`dist/` for MCP; the editor is the only built artifact). `scripts/docker-entrypoint.sh`
dispatches by `FOLIO_MODE`:

```
FOLIO_MODE=ui    → serve.sh       → editor static server (:4173)
FOLIO_MODE=mcp   → serve-mcp.sh   → MCP HTTP server (:3333)
FOLIO_MODE=both  → both (MCP in bg)   ← compose default
```

- **Editor server** (`src/editor/static-server.ts`, Bun) serves the built editor from
  `dist/` and mounts `FOLIO_PROJECTS_DIR` at `/__project_files/*`. *(This replaced the
  old `vite preview`.)*
- **MCP server** (`src/mcp/http-server.ts`, Bun) serves JSON-RPC + SSE + OAuth + health.

Both run under `bun --smol` for a lower footprint in the memory-capped container.

### 5.1 Hot redeploy (no rebuild)

Because the server runs from source, a code change deploys as a tree sync + restart:

```bash
docker cp src/. folio:/app/src && docker restart folio
curl -fsS http://localhost:3333/health
```

Copy the **whole `src/` tree** — facades re-export their siblings, so a partial copy
breaks the import graph. (The editor only needs a rebuild if `dist/` changed.)

### 5.2 Memory limits

`docker-compose.yml` sets `mem_limit: 1g` (override with `FOLIO_MEM_LIMIT`, e.g. `2g`).
Runtime guards: `/mcp` body ≤ `FOLIO_MAX_BODY_BYTES` (32 MiB), OAuth bodies ≤ 256 KiB,
`editorBroadcast` skips files over `FOLIO_MAX_BROADCAST_BYTES` (16 MiB), dead SSE
clients pruned on write. Steady state ≈ 230 MiB idle, ≈ 400 MiB during PNG export.

### 5.3 Access hardening — the editor / library front-door

The link any tool returns (`open_url`, `short_url`, `view_url`) is **self-authenticating**:
possession = access, no login. That is convenient but means a *leaked* link is usable by
anyone who sees it. Three opt-in guards on the editor server (`:4173` — the editor,
the Design Library, and `/__project_files/*`) lock this down without adding a login.

| Env var | Default | Effect |
|---|---|---|
| `FOLIO_ALLOW_IPS` | *(unset = open)* | Comma/space list of exact IPs **and IPv4 CIDRs** (e.g. `203.0.113.7, 10.0.0.0/8`). When set, every request from any other IP is refused with **403 before** the short-link / auth / static handlers — so a leaked link is **inert off-network**. This is the "only me, even if the link leaks, no login" control. |
| `FOLIO_EDITOR_RATE_BURST` | `240` | Per-IP token-bucket size (a page load is many small assets, so it's generous). `0` disables. |
| `FOLIO_EDITOR_RATE_PER_SEC` | `80` | Per-IP steady refill rate. Overflow → **429 + Retry-After**, so one client's flood can't monopolise the single-threaded server. |
| `FOLIO_EDITOR_MAX_HEAVY` | `8` | Max concurrent **expensive** ops (thumbnail rasterize, full-library scan). Beyond it → **503 + Retry-After:1**, so a burst can't pile up and OOM/peg the container. `0` = unlimited. |

Finding your IP to allow-list: `curl https://<host>/__ip` → `{"ip":"…","allow_list_active":…}`.
`/__ip` is intentionally exempt from the allow-list (it reveals only the caller's own
address). Blocked requests are logged: `[serve-static] BLOCKED ip=… GET /…`.

The client IP is taken from the **last `X-Forwarded-For` hop** (the value the trusted
edge proxy appends) so a client can't spoof an allow-listed address by injecting its own
XFF. `/mcp` (`:3333`) has its own per-token+IP limiter (`FOLIO_RATE_BURST` / `FOLIO_RATE_PER_SEC`);
leave the allow-list **off** there if a remote model (claude.ai, a hosted harness) must reach it.

> The public domain in every link is **not hard-coded** — it comes from `FOLIO_EDITOR_URL`
> + `FOLIO_MCP_PUBLIC_URL` (default `http://localhost:4173` / `:3333`). Change those two env
> vars and every generated link follows; no code edit, no rebuild.

---

## 6. ENDPOINT REFERENCE (HTTP mode)

### 6.1 MCP server (`:3333`, proxied at `/` by Caddy)

| Method · path | Auth | Purpose |
|---|---|---|
| `GET  /health` | none | `{status, version, tiers, auth}` |
| `POST /mcp` | Bearer | JSON-RPC: `initialize` · `tools/list` · `tools/call` |
| `GET  /mcp/sse` | Bearer | SSE: every tool response |
| `GET  /editor/events` | Bearer or `?token=` | SSE: file-change events (live editor refresh) |
| `GET  /tokens/whoami` | Bearer | The named token that authenticated |
| `GET  /.well-known/oauth-authorization-server` | none | OAuth metadata (RFC 8414) |
| `GET  /.well-known/oauth-protected-resource` | none | OAuth metadata (RFC 9728) |
| `GET/POST /oauth/authorize` | none | Login form → auth code (PKCE) |
| `POST /oauth/token` | none | code/refresh → access token |
| `POST /oauth/register` | none | Dynamic client registration (RFC 7591) |

### 6.2 Editor server (`:4173`)

| Path | Auth | Purpose |
|---|---|---|
| `/` and assets | basicauth or `?token=` / cookie | The visual editor app |
| `/__project_files/*` | Bearer / `?token=` / `folio_session` cookie | Fetch a `.design.yaml` for the editor |

### 6.3 Caddy routing (TLS profile)

`caddy/Caddyfile` proxies one public domain:

```
/mcp · /mcp/* · /tokens/* · /health   → folio:3333   [Bearer; /health public]
/.well-known/oauth-* · /oauth/*        → folio:3333   [public — connector discovery]
/editor/events?token=*                 → folio:3333   [token-validated by MCP]
/editor/events                         → folio:3333   [basicauth]
/__project_files/*                     → folio:4173   [token or cookie]
/files · /files/*                      → /srv/files   [basicauth — download exports]
everything else (/, assets)            → folio:4173   [basicauth, or ?token→cookie]
```

`/.well-known/*` and `/oauth/*` are deliberately **not** behind basicauth so claude.ai
can discover and complete the OAuth dance unauthenticated. `X-Forwarded-Proto`/`-Host`
are forwarded so the engine builds correct absolute URLs.

---

## 7. AUTH

### 7.1 Bearer token modes (first that resolves wins)

| Mode | Env / file | When |
|---|---|---|
| Multi-token file | `FOLIO_TOKENS_FILE=/home/folio/tokens.json` | Production — named, audited per client |
| Multi-token inline | `FOLIO_TOKENS="claude:sk-aaa,hermes:sk-bbb"` | Env-only deploys (no file mount) |
| Single key | `FOLIO_API_KEY=sk-...` | Legacy / single client |
| Open | none set | Localhost / private network only |

`tokens.json` format — key is the **name** (shown in the audit log), value is the
bearer string the client sends:

```json
{ "claude-desktop": "sk-folio-7f9c4…", "claude-code": "sk-folio-3a1b2…", "hermes": "sk-folio-d8e7f…" }
```

Generate strong tokens: `openssl rand -hex 32`.

### 7.2 JWT — stateless editor links

`FOLIO_JWT_SECRET` (HS256; falls back to `FOLIO_API_KEY` if unset) signs the editor-link
tokens that `open_in_editor` / `create_design` embed in their `open_url`. These are
**stateless 30-day JWTs** — no server store, survive restarts (a pasted link no longer
dies after an hour). The raw secret also works as a master bearer. TTL via
`FOLIO_EDITOR_TOKEN_TTL_MS` (default 30 days).

### 7.3 OAuth 2.0 + PKCE — the claude.ai connector path

`src/mcp/oauth.ts` exposes a standards-compliant Authorization-Code + PKCE flow plus
Dynamic Client Registration and a refresh grant. The access token issued by
`/oauth/token` bridges to whichever Folio API key the user types at `/oauth/authorize`.
Access tokens (24h) and refresh tokens (30d, rotating) are persisted to
`FOLIO_OAUTH_STATE_DIR` (default `<projects>/.oauth-state`) so a container bounce never
forces a re-auth. Pin a client with `FOLIO_OAUTH_CLIENT_ID` (default `claude-ai`); leave
`FOLIO_OAUTH_CLIENT_SECRET` blank for a public PKCE-only client. See
[INTEGRATIONS.md §2](INTEGRATIONS.md) for the claude.ai setup walkthrough.

### 7.4 Audit log

Every authenticated `tools/call` writes one line to stderr; token **values** are never
logged:

```
[mcp] token=claude-desktop tool=create_design ok=true
```

Tail it: `docker compose logs -f folio`.

### 7.5 Rotating a token

1. Add a new entry to `tokens.json` (`"claude-desktop-v2": "sk-new…"`).
2. `docker compose restart folio` (≤1 s downtime).
3. Switch the client to the new token.
4. Remove the old entry; restart again.

---

## 8. ENVIRONMENT VARIABLES

| Variable | Default | Description |
|---|---|---|
| `FOLIO_MODE` | `ui` (compose: `both`) | Container role: `ui` · `mcp` · `both` |
| `FOLIO_PORT` | `3333` | MCP HTTP port (in-container) |
| `PORT` | `4173` | Editor port (in-container) |
| `FOLIO_PROJECTS_DIR` | `/home/folio/projects` | Where designs live in the container |
| `FOLIO_OUTPUT_BUDGET` | `1000` | Max tokens per MCP tool response |
| `FOLIO_MCP_TIER` | `1` | **stdio only:** `1` · `2` · `3` · `all` |
| `MCP_CONSTRAINED_MODE` | `false` | Halve list/layer/search limits for low-RAM |
| `FOLIO_TOKENS_FILE` | unset | JSON file of named tokens (highest priority) |
| `FOLIO_TOKENS` | unset | Inline `"name:val,name2:val2"` |
| `FOLIO_API_KEY` | unset | Single shared bearer (legacy) |
| `FOLIO_JWT_SECRET` | unset → `FOLIO_API_KEY` | HS256 secret for editor-link JWTs + master bearer |
| `FOLIO_EDITOR_TOKEN_TTL_MS` | `2592000000` (30d) | Editor-link token lifetime |
| `FOLIO_OAUTH_CLIENT_ID` | `claude-ai` | Pinned OAuth client id |
| `FOLIO_OAUTH_CLIENT_SECRET` | unset (public) | Set only for a confidential client |
| `FOLIO_OAUTH_STATE_DIR` | `<projects>/.oauth-state` | Persisted OAuth tokens |
| `FOLIO_EDITOR_URL` | `http://localhost:4173` | Public editor base baked into links |
| `FOLIO_MCP_PUBLIC_URL` | derived from `FOLIO_DOMAIN` | Public MCP base baked into links |
| `FOLIO_DOMAIN` | unset | Public hostname (Caddy TLS profile) |
| `FOLIO_ACME_EMAIL` | unset | Let's Encrypt registration email |
| `FOLIO_BASIC_USER` / `FOLIO_BASIC_HASH` | unset | Editor Basic Auth (required by TLS profile) |
| `FOLIO_MEM_LIMIT` | `1g` | Container memory ceiling |
| `FOLIO_MAX_BODY_BYTES` | `33554432` | `/mcp` request body cap |
| `FOLIO_MAX_BROADCAST_BYTES` | `16777216` | Max file size read for editor SSE fan-out |
| `FOLIO_SKIP_TESTS` | `0` | `1` skips the test suite during `docker build` |
| `FOLIO_UI_PORT` / `FOLIO_MCP_PORT` | `4173` / `3333` | Compose: host port mappings |

---

## 9. OPERATIONS

### 9.1 Updating

```bash
git pull
docker compose --profile tls up -d --build      # full rebuild (runs tests unless FOLIO_SKIP_TESTS=1)
# or, for a code-only change with the container already up:
docker cp src/. folio:/app/src && docker restart folio
```

### 9.2 Backups

The only state is `./folio-projects` (designs, tasks, exports, `.oauth-state`) and
`./tokens.json` — plain files. Back them up with rsync / restic / borg.

### 9.3 Health checks

```bash
curl -fsS http://localhost:3333/health          # liveness, no auth
docker compose ps                                # container health column
docker compose logs -f folio caddy               # logs + audit lines
```

### 9.4 Teardown

```bash
docker compose --profile tls down -v             # also removes caddy_data/config
docker rmi folio:latest
rm -rf ./folio-projects                          # optional: delete designs
```

---

## 10. SEE ALSO

- [INTEGRATIONS.md](INTEGRATIONS.md) — connect claude.ai / Claude Code / LM Studio / harnesses
- [MCP.md](MCP.md) — the protocol, tiers, workflows
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the servers + auth are built
- [EDITOR.md](EDITOR.md) — the editor server, links, and live refresh
