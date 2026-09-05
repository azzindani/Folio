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
`FOLIO_MCP_TIER` chooses the surface: `1` (6 tools), `2` (7), `3` (8), or `all` (21).

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
   # Optional — only if you use the /files raw-download browser:
   # FOLIO_BASIC_USER=admin
   # FOLIO_BASIC_HASH=<bcrypt hash: docker run --rm caddy:2-alpine caddy hash-password --plaintext '...'; escape $ as $$>
   ```
   The **editor itself needs no Basic Auth** — it is gated solely by the access
   token / `folio_session` cookie (see §5.3 and §7.2). Basic Auth applies only to
   the optional `/files` download browser.
5. **Edit `tokens.json`** — replace every placeholder with a long random string
   (`openssl rand -hex 32`). Keep it out of git (`.gitignore` excludes it).
6. **Bring it up with TLS:**
   ```bash
   docker compose --profile tls up -d --build
   ```

Caddy requests a Let's Encrypt cert for `FOLIO_DOMAIN` and terminates HTTPS in under
a minute. Confirm:

```bash
curl -fsS https://folio.your-domain.tld/health
# → {"status":"ok","version":"0.1.1","update_available":false,"tiers":["1","2","3"],"auth":"multi"}

curl -H "Authorization: Bearer <one-of-your-tokens>" \
     https://folio.your-domain.tld/tokens/whoami
# → {"token":"claude-desktop","auth_mode":"multi"}
```

---

## 4.5 STAYING UP TO DATE

Two separate mechanisms. **Detection is on by default; applying is not.**

### Detect — every deployment, no setup

The engine polls the GitHub Releases API (daily, jittered, floored at 1h) and caches the
answer. Ask any instance what it's running:

```bash
curl -fsS https://folio.your-domain.tld/version
# → {"current":"0.1.1","latest":"0.2.0","update_available":true,
#    "release_url":"https://github.com/azzindani/Folio/releases/tag/v0.2.0",
#    "checked_at":"2026-07-11T05:40:00Z","enabled":true}
```

`/version` and `/health` are **unauthenticated** (like `/health` already was), so a monitor
or a cron one-liner can alert on a stale deployment without holding an API token:

```bash
# nag me daily if my box is behind
curl -fsS localhost:3333/version | grep -q '"update_available":true' && echo "Folio update available"
```

A new release also logs once, at detection:
`[update] Folio 0.2.0 is available (running 0.1.1) — https://…`

Properties worth knowing:
- **No telemetry.** An anonymous, unauthenticated `GET api.github.com/repos/…/releases/latest`.
  No install id, no version report, nothing about you leaves the box.
- **Fail-silent.** Offline, rate-limited or DNS-dead → the check returns null and the last
  known answer stands. It can never affect serving.
- **Opt out** with `FOLIO_UPDATE_CHECK=0` (air-gapped / no-outbound-calls policies).
- Watching a fork? `FOLIO_UPDATE_REPO=you/YourFork`.

### Apply — pick your posture

| Posture | How | Trade-off |
|---|---|---|
| **Manual** (default) | `/version` tells you; you run `scripts/update.sh` or `docker compose pull && up -d` | Full control; you must actually look |
| **Pinned** | `FOLIO_IMAGE=ghcr.io/azzindani/folio:0.1.1` | Reproducible; review each release, upgrade on purpose |
| **Unattended** | `--profile autoupdate` (Watchtower) | Security fixes land by themselves; so does a bad release |

Unattended:

```bash
# .env
FOLIO_IMAGE=ghcr.io/azzindani/folio:latest      # Watchtower pulls a REGISTRY tag —
                                                # it cannot rebuild a local source build
docker compose --profile autoupdate up -d --pull always --no-build
```

Watchtower runs label-scoped (`WATCHTOWER_LABEL_ENABLE`), so it only ever touches the
`folio` container — never anything else on the host. It polls the registry daily
(`FOLIO_AUTOUPDATE_INTERVAL_SEC`), pulls a new digest of the tag, and recreates the
container with the same env/mounts. Projects live on a bind mount and survive.

Be deliberate about this: unattended upgrade means a bad release — or anyone who
compromises the registry — reaches your host with no human in the loop. The honest default
for a design engine holding your files is **pinned + notified**, which is why `autoupdate`
is opt-in.

> **Why polling and not a GitHub webhook?** A `release` webhook needs a publicly reachable
> URL and a shared secret *per deployment*. Most self-hosted installs sit behind NAT with no
> inbound port, so a webhook can't reach them at all. An outbound poll works everywhere with
> zero configuration. (If your instance *is* public and you want instant delivery, point a
> repo webhook at your own CD runner — that's a deploy pipeline concern, not the engine's.)

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

`docker-compose.yml` sets `mem_limit: 4g` (override with `FOLIO_MEM_LIMIT`; 1 GiB
OOM-killed the MCP server mid-harness-run, so don't go below 2g under load).
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
| `FOLIO_EDITOR_TOKEN_TTL_MS` | `2592000000` (30 **days**) | **Editor + Library session** lifetime — the durable, always-on cookie. |
| `FOLIO_OUTPUT_LINK_TTL_MS` | `1800000` (30 **min**) | **Output-link** lifetime — the `?token=` in a generated `open_url`/`view_url` and the `/o/<code>` short link. **Ephemeral** (see below). |

**Two lifetimes, deliberately separate (no IP-lock, no login).** The editor and the
Design Library are the operator's app — they must stay **always-on**, so the `folio_session`
cookie they run on is **durable (30 days, `FOLIO_EDITOR_TOKEN_TTL_MS`)** and slides on
activity. A **generated output link** is a different thing: a thing you *show* — so the
`?token=` in `open_url`/`view_url` and the `/o/<code>` short link are **ephemeral
(30 min, `FOLIO_OUTPUT_LINK_TTL_MS`)**. A link caught on a recording is dead 30 min later.

The two don't collide. **Opening** an output link (within its 30 min) **upgrades you to the
30-day session**: the cookie is minted **fresh** server-side as a session token — it does
**not** inherit the short output token's clock. So you stay logged into the editor/library
for 30 days, while the standalone link you showed still expires. To bring an expired output
back, **open the design from the (always-on) Library** — that mints a brand-new 30-min link,
over and over. The short `/o/<code>` link expires on the same output clock
(`FOLIO_SHORT_LINK_TTL_MS`, default = `FOLIO_OUTPUT_LINK_TTL_MS`) and does **not** revive
itself when visited — only re-issuing it (a tool call, or opening the design from the Library)
does. The token rides in a `HttpOnly`, `SameSite=Lax` cookie, stripped from the address bar
on first load.

> Recording note: an output link opened *within* its 30-min window grants the opener the
> 30-day session too (there's no login to tell you apart from a viewer). For the published-
> video case this is moot — the link is dead long before anyone watches. If you ever need
> the tight window even live, set `FOLIO_ALLOW_IPS` (above) or shorten `FOLIO_OUTPUT_LINK_TTL_MS`.

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
| `/` and assets | `?token=` / Bearer / `folio_session` cookie (app is sole gate) | The visual editor app |
| `/__project_files/*` | Bearer / `?token=` / `folio_session` cookie | Fetch a `.design.yaml` for the editor |

### 6.3 Caddy routing (TLS profile)

`caddy/Caddyfile` proxies one public domain:

```
/mcp · /mcp/* · /tokens/* · /health   → folio:3333   [Bearer; /health public]
/.well-known/oauth-* · /oauth/*        → folio:3333   [public — connector discovery]
/editor/events?token=*                 → folio:3333   [token-validated by MCP]
/editor/events                         → folio:3333   [token / cookie — plain 401, no popup]
/__project_files/*                     → folio:4173   [token or cookie]
/files · /files/*                      → /srv/files   [basicauth — download exports]
everything else (/, assets)            → folio:4173   [?token→cookie; app is the sole gate, no basicauth]
```

The editor is **not** behind Basic Auth — `folio:4173` gates it with the access
token / `folio_session` cookie and serves its own "access token required" page
otherwise (no browser username/password popup). Basic Auth remains only on the
`/files` raw-download browser. `/.well-known/*` and `/oauth/*` are deliberately **not** behind basicauth so claude.ai
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

`FOLIO_JWT_SECRET` (HS256; falls back to `FOLIO_API_KEY` if unset) signs every editor
token — no server store, survive restarts. Two TTLs (see §5.3): the `?token=` an
`open_in_editor` / `create_design` embeds in its `open_url` is an **ephemeral 30-min output
token** (`FOLIO_OUTPUT_LINK_TTL_MS`); opening it mints the **durable 30-day session** cookie
(`FOLIO_EDITOR_TOKEN_TTL_MS`) that keeps the editor + library always-on. The raw secret also
works as a master bearer.

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
| `FOLIO_SHARED_DIRS` | unset | Comma-separated extra roots shared with **sibling MCP servers** (e.g. `/workspace/data`). See [Filesystem boundary](#filesystem-boundary) |
| `FOLIO_BUILTIN_TEMPLATES_DIR` | auto (install-relative) | Built-in `.template.yaml` catalog dir — set only if it lives outside the install |
| `FOLIO_BUILTIN_INDEX` | auto (install-relative) | Catalog metadata index (`catalog-index.json`) |
| `FOLIO_ASSET_FETCH_HOSTS` | unset | Comma-separated extra hosts `asset_fetch` may download from |
| `FOLIO_OUTPUT_BUDGET` | `1000` | Max tokens per MCP tool response |
| `FOLIO_MCP_TIER` | `1` | **stdio only:** `1` · `2` · `3` · `all` |
| `MCP_CONSTRAINED_MODE` | `false` | Halve list/layer/search limits for low-RAM |
| `FOLIO_TOKENS_FILE` | unset | JSON file of named tokens (highest priority) |
| `FOLIO_TOKENS` | unset | Inline `"name:val,name2:val2"` |
| `FOLIO_API_KEY` | unset | Single shared bearer (legacy) |
| `FOLIO_JWT_SECRET` | unset → `FOLIO_API_KEY` | HS256 secret for editor-link JWTs + master bearer |
| `FOLIO_EDITOR_TOKEN_TTL_MS` | `2592000000` (30d) | Editor + Library **session** lifetime (durable cookie) |
| `FOLIO_OUTPUT_LINK_TTL_MS` | `1800000` (30m) | **Output-link** lifetime (`open_url`/`view_url` `?token`, `/o` short link) |
| `FOLIO_OAUTH_CLIENT_ID` | `claude-ai` | Pinned OAuth client id |
| `FOLIO_OAUTH_CLIENT_SECRET` | unset (public) | Set only for a confidential client |
| `FOLIO_OAUTH_STATE_DIR` | `<projects>/.oauth-state` | Persisted OAuth tokens |
| `FOLIO_EDITOR_URL` | `http://localhost:4173` | Public editor base baked into links |
| `FOLIO_MCP_PUBLIC_URL` | derived from `FOLIO_DOMAIN` | Public MCP base baked into links |
| `FOLIO_DOMAIN` | unset | Public hostname (Caddy TLS profile) |
| `FOLIO_ACME_EMAIL` | unset | Let's Encrypt registration email |
| `FOLIO_BASIC_USER` / `FOLIO_BASIC_HASH` | unset | Basic Auth for the optional `/files` download browser only (the editor is token/cookie-gated, no Basic Auth) |
| `FOLIO_MEM_LIMIT` | `4g` | Container memory ceiling |
| `FOLIO_MAX_BODY_BYTES` | `33554432` | `/mcp` request body cap |
| `FOLIO_MAX_BROADCAST_BYTES` | `16777216` | Max file size read for editor SSE fan-out |
| `FOLIO_SKIP_TESTS` | `0` | `1` skips the test suite during `docker build` |
| `FOLIO_UI_PORT` / `FOLIO_MCP_PORT` | `4173` / `3333` | Compose: host port mappings |

### Filesystem boundary

Stated once, here, so it isn't discovered one refused call at a time. Folio reads
and writes under exactly these roots:

```
$HOME · $TMPDIR · FOLIO_PROJECTS_DIR · FOLIO_SHARED_DIRS · the built-in catalog (read-only)
```

Anything else is refused by `resolvePath()`, and the error names the roots that
do work. This matters when Folio runs **beside other MCP servers** (a data/ML
server, a document server): they do NOT share a filesystem by default, so

| Symptom | Cause | Fix |
|---|---|---|
| `asset_add source_path:"/workspace/data/chart.png"` → *Path outside allowed directories* | that dir is not a Folio root | add it to `FOLIO_SHARED_DIRS`, or pass the file inline as a `data:` URI |
| `export_design output_path:"/workspace/data/deck.pdf"` → *Permission denied* | same | same, or export to the project and copy it out |
| `asset_fetch ref:"https://files.example.com/…"` → *Host not allowed* | fetch allowlist | add the host to `FOLIO_ASSET_FETCH_HOSTS` |

```yaml
# docker-compose.yml — sharing one folder with a sibling data server
environment:
  FOLIO_SHARED_DIRS: /workspace/data
volumes:
  - ./workspace/data:/workspace/data
```

Opt-in on purpose: the sandbox stays closed unless a deployment opens it.

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
