# INTEGRATIONS.md — Connecting Clients & Harnesses

> Folio is a standard MCP server, so **any** MCP-capable client can drive it — no
> Folio-specific client code. This doc walks through the common ones. For hosting see
> [DEPLOYMENT.md](DEPLOYMENT.md); for the protocol see [MCP.md](MCP.md).

The golden rule: **if a client speaks MCP (stdio or JSON-RPC-over-HTTP with a bearer
header), it works.** Everything below is just "where do I paste the URL and token."

| Client | Transport | Section |
|---|---|---|
| claude.ai (Custom Connector) | HTTPS + OAuth | [§2](#2-claudeai--custom-connector) |
| Claude Code (CLI) | HTTP or stdio | [§3](#3-claude-code) |
| LM Studio | stdio or HTTP | [§4](#4-lm-studio) |
| Hermes / OpenClaw / any agent | HTTP + bearer | [§5](#5-hermes-openclaw--any-mcp-over-http-harness) |
| The Folio visual editor | SSE live-refresh | [§6](#6-the-visual-editor--live-refresh) |

---

## 1. PREREQUISITE — a reachable endpoint

- **Local / stdio** clients launch Folio themselves (no URL). Skip to [§3.2](#32-claude-code--stdio-local) / [§4.1](#41-lm-studio--stdio).
- **Remote / HTTP** clients need a running HTTP server and a token. Stand one up per
  [DEPLOYMENT.md](DEPLOYMENT.md), then verify:
  ```bash
  curl -fsS https://folio.your-domain.tld/health     # {"status":"ok",...}
  ```

All HTTP clients hit the same endpoint:

```
POST  https://folio.your-domain.tld/mcp          ← JSON-RPC (initialize/tools/list/tools/call)
GET   https://folio.your-domain.tld/mcp/sse      ← optional tool-result SSE
Auth: Authorization: Bearer <token>
```

---

## 2. claude.ai — Custom Connector

claude.ai connects over **OAuth 2.0 + PKCE** (it will not accept a raw bearer in the
connector form), so this path needs the HTTPS deployment with the OAuth surface — i.e.
the Caddy TLS profile.

### 2.1 Setup

1. **Settings → Connectors → Add custom connector.**
2. **URL:** `https://folio.your-domain.tld/mcp`
3. **Save.** claude.ai discovers `/.well-known/oauth-authorization-server`, registers a
   client (DCR), and redirects you to Folio's `/oauth/authorize` login page.
4. On that page, **paste a Folio API key** — any value from `tokens.json` or your
   `FOLIO_API_KEY`. This is the principal the issued OAuth token will act as.
5. claude.ai completes the PKCE exchange, stores the access + refresh tokens, runs
   `tools/list`, and surfaces all 21 tools.

### 2.2 What happens under the hood

```
claude.ai ──▶ GET /.well-known/oauth-authorization-server   (discover)
          ──▶ POST /oauth/register                          (DCR → client_id)
          ──▶ GET  /oauth/authorize?...&code_challenge=...   (you paste API key)
          ◀── 302 redirect with ?code=...
          ──▶ POST /oauth/token  (code + code_verifier)      → access + refresh token
          ──▶ POST /mcp  Authorization: Bearer <access_token>   (every call)
```

Access tokens last 24h; the refresh token (30d, rotating) lets claude.ai mint new ones
silently. Both are persisted, so a container restart does **not** force a re-auth.

### 2.3 Notes & troubleshooting

- HTTPS is mandatory (Anthropic requires it). Use the Caddy TLS profile, or front Folio
  with Cloudflare Tunnel / nginx + Let's Encrypt.
- Pin a known client with `FOLIO_OAUTH_CLIENT_ID`; leave `FOLIO_OAUTH_CLIENT_SECRET`
  blank for a public PKCE-only client (recommended for claude.ai).
- "Asks me to authorize every time" → the refresh grant or persisted state dir isn't
  working; check `FOLIO_OAUTH_STATE_DIR` is writable and survives restarts.
- "Invalid API key" on the authorize page → the value you pasted isn't in `tokens.json`
  / `FOLIO_API_KEY`.

---

## 3. Claude Code

### 3.1 Claude Code — hosted (HTTP)

Point the CLI at your deployed instance with a bearer header (`.mcp.json` in your
project or your user MCP config):

```json
{
  "mcpServers": {
    "folio": {
      "url": "https://folio.your-domain.tld/mcp",
      "headers": { "Authorization": "Bearer sk-folio-..." }
    }
  }
}
```

### 3.2 Claude Code — stdio (local)

Run Folio as a subprocess (no server, no token). Bun recommended:

```json
{
  "mcpServers": {
    "folio": {
      "command": "bun",
      "args": ["run", "/abs/path/Folio/src/mcp/index.ts"],
      "env": { "FOLIO_MCP_TIER": "all", "FOLIO_OUTPUT_BUDGET": "1000" }
    }
  }
}
```

Self-updating bootstrap (clone if missing, pull, run):

```json
{ "command": "bash",
  "args": ["-c", "[ -d ~/.folio_mcp ] || git clone https://github.com/azzindani/Folio ~/.folio_mcp && cd ~/.folio_mcp && git pull && bun install --frozen-lockfile && FOLIO_MCP_TIER=all bun run src/mcp/index.ts"] }
```

> After adding the server, reconnect/restart Claude Code so it re-runs `tools/list`.
> Reference an attached image? The model already sees it — call `extract_reference`
> with the colors it observes to get exact dims + a role-mapped palette.

---

## 4. LM Studio

### 4.1 LM Studio — stdio

The original mode: LM Studio launches Folio per tier. Register three exclusive servers
for the full surface without duplicate tool names, or a single `all`:

```json
{
  "mcpServers": {
    "folio_basic":  { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"],
                      "env": { "FOLIO_MCP_TIER": "1", "FOLIO_OUTPUT_BUDGET": "1000" }, "timeout": 600000 },
    "folio_design": { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"],
                      "env": { "FOLIO_MCP_TIER": "2", "FOLIO_OUTPUT_BUDGET": "1000" }, "timeout": 600000 },
    "folio_export": { "command": "bun", "args": ["run", "/abs/path/Folio/src/mcp/index.ts"],
                      "env": { "FOLIO_MCP_TIER": "3", "FOLIO_OUTPUT_BUDGET": "1000" }, "timeout": 600000 }
  }
}
```

Tier sizing for local models: **≤32K ctx → tier 1 only** (6 tools); **64K → 1+2** (13);
**128K → all three**. Windows: use the PowerShell self-updating bootstrap from the
[README](../README.md#local--lm-studio-stdio); pre-clone once to avoid the first-launch
timeout.

### 4.2 LM Studio — HTTP

LM Studio (≥ v0.3) can also talk to a running Folio over HTTP — useful when Folio is in
Docker and you don't want LM Studio cloning its own copy:

```json
{ "mcpServers": { "folio": {
    "url": "http://localhost:3333/mcp",
    "headers": { "Authorization": "Bearer sk-folio-lmstudio-..." } } } }
```

---

## 5. Hermes, OpenClaw & any MCP-over-HTTP harness

Any client that speaks JSON-RPC over HTTP with a bearer header works. The minimal
shape (adapt to your harness's config format):

```yaml
mcp_servers:
  folio:
    transport: http
    url: https://folio.your-domain.tld/mcp
    auth:
      type: bearer
      token: sk-folio-hermes-...
```

Per-harness named token (recommended) → each gets its own line in `tokens.json`, and
the audit log records which connector called which tool. Verify connectivity:

```bash
curl -s https://folio.your-domain.tld/mcp \
  -H "Authorization: Bearer sk-folio-hermes-..." -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools|length'   # → 21
```

> **Custom harness checklist:** (1) `initialize` → expect `protocolVersion 2024-11-05`;
> (2) send `notifications/initialized`; (3) `tools/list` to cache schemas; (4) `tools/call`
> with `{name, arguments}`; (5) parse the `content[0].text` as the `ToolResult` JSON and
> **follow `next_action`** to chain tools. See [MCP.md §5](MCP.md) for the result contract.

---

## 6. The visual editor — live refresh

The editor and MCP server share one origin behind Caddy, so a human can watch the LLM's
edits paint in real time.

### 6.1 The `open_url` link

`create_design` / `append_page` / `seal_design` / `export_design` return an `open_url`
(and `open_in_editor` mints one on demand). It is a single self-contained link:

```
https://folio.your-domain.tld/?file=<path>&mcp_url=<base>&token=<jwt>
```

- The `?token=` is validated by the static server (a stateless 30-day JWT when
  `FOLIO_JWT_SECRET` is set) — the sole editor gate, no Basic Auth in front — and sets
  a `folio_session` cookie so subsequent same-tab navigation just works.
- The editor opens an `EventSource` on `<mcp_url>/editor/events`.

### 6.2 The refresh loop

```
LLM calls a file-mutating tool (add_layers, patch_design, seal_design, …)
   → MCP server writes the .design.yaml
   → editorBroadcast('file_changed', path) on /editor/events (SSE)
   → the open editor reloads that design — no manual refresh
```

`FILE_MUTATING_TOOLS` in `http-server.ts` lists which tools trigger this. Run the model
in one tab, keep the editor open in another, and watch it update.

### 6.3 Reports & presentations

`report` (op:export) returns **`view_url`** — give the user *that* (the final interactive
HTML), not the editor link; the canvas is an authoring view, not a faithful preview of
the export. `presentation` (op:export) writes a self-contained HTML presenter. Full editor
guide: [EDITOR.md](EDITOR.md).

---

## 7. Remote presenter & collaboration

Two MCP tools generate standalone SSE helpers (separate from the main server):

- **`presentation` (op:remote)** → an SSE clicker server + client JS snippet + curl
  commands to drive slide navigation over HTTP (phone-as-remote). Default port `3737`.
- **`presentation` (op:collab)** → an SSE file-watch server with `/patch` + `/events` for multi-user
  design sync. Default port `3738`.

Both return ready-to-run code; they don't auto-start inside the main container.

---

## 8. SEE ALSO

- [DEPLOYMENT.md](DEPLOYMENT.md) — stand up the endpoint these clients connect to
- [MCP.md](MCP.md) — protocol, tiers, the handover/next_action contract
- [TOOLS.md](TOOLS.md) — every tool's params
- [EDITOR.md](EDITOR.md) — the editor, links, and live refresh in depth
