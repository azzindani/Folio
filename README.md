# Folio

A self-hosted MCP server and browser-based graphic design editor that gives local LLMs structured tools to generate, edit, and export designs as plain YAML files. No cloud APIs, no subscriptions — everything runs on your machine or your VPS.

## Documentation

Full guides live in [`docs/`](docs/README.md):

| Doc | Covers |
|---|---|
| [docs/MCP.md](docs/MCP.md) | Folio as an MCP engine — transports, tiers, protocol, workflows, shorthand |
| [docs/TOOLS.md](docs/TOOLS.md) | Reference for all 49 MCP tools (params, returns, examples) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy modes, Docker + Caddy/TLS, endpoints, env vars, auth, ops |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Connect claude.ai, Claude Code, LM Studio, Hermes/OpenClaw, the editor |
| [docs/EDITOR.md](docs/EDITOR.md) | Visual editor — canvas, panels, shortcuts, export, live refresh |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, render pipeline, build & test |
| [docs/DESIGN.md](docs/DESIGN.md) · [docs/REPORT_ENGINE.md](docs/REPORT_ENGINE.md) | Payload spec · interactive reports |

## Features

- **49 MCP tools** across 3 tiers: Basic (15), Design (10), Export (24)
- **CREATE → COMPOSE → SEAL → EXPORT** workflow for structured design generation
- **Multiple transports** — stdio (local LM Studio / Claude Code) and spec-compliant **Streamable HTTP** (Claude Connectors, LM Studio remote, Hermes, OpenClaw, any MCP-over-HTTP client), with an optional tool-result SSE stream
- **Multi-token auth** — issue named bearer tokens per connector; audit log records which token called which tool
- **Self-hostable via Docker** — single image, compose file, optional Caddy sidecar for auto-HTTPS
- **Browser editor over the same URL** — visual editor and MCP API share one domain when behind a reverse proxy
- **Live SVG export** — server-side jsdom renderer writes real `.svg` files from MCP without a browser
- **Automatic snapshots** — every write creates a `.mcp_versions/` backup before touching disk
- **Operation receipt logging** — full audit trail at `~/.folio/ops.log`
- **Constrained output mode** — caps tool responses at 1,000 tokens for local models (configurable)
- **Handover protocol** — every response includes the next 3 suggested tool calls with pre-filled params so LLMs can chain tools without losing state
- **Context recovery** — `resume_task` and `resume_design` restore full carousel state after context resets
- **Shorthand layer syntax** — `pos:[x,y,w,h]`, `fill:"#hex"`, `icon:"star"` — ~80% fewer tokens than verbose YAML
- **14 layer types** — rect, circle, text, line, path, icon, image, group, mermaid, chart, code, math, component, particle
- **Interactive report HTML** — `export_report` assembles multi-page reports into a self-contained `.html` with navigation runtime, `$data.*` expression binding, and Mode A interactions
- **Presentation engine** — `create_presentation` + `export_presentation` produce 17-transition self-contained HTML decks with keyboard nav, touch swipe, auto-advance, teleprompter mode, and audio cues
- **Formula binding** — PowerApps-style `=expression` on any layer property; `set_formula_context` + `debug_formula` MCP tools; secure sandboxed evaluator
- **Animation timeline** — keyframe scrubber UI panel, `inspect_timeline` + `add_keyframe` MCP tools, Lottie JSON export, GIF/MP4/WebM export (ffmpeg when available)
- **Motion + effects** — SVG `animateMotion` path animation, particle effects layer, 3D `rotate3d` transforms, scroll-triggered animations
- **Theme token system** — `$primary`, `$heading`, `$text_muted` resolved at render time from active theme
- **Component library** — reusable layer groups with named slot definitions
- **Carousel / multi-page** — incremental page-by-page generation with task state tracking
- **dry_run validation** — `patch_design` validates all selectors before writing
- **Visual editor** — browser canvas with 8-point resize handles, rotation, rubber-band multi-select, align toolbar, Monaco YAML editor with bidirectional sync
- **Live editor refresh** — `/editor/events` SSE pushes file-change events so the browser reloads instantly when an MCP tool mutates a design
- **Remote clicker** — `setup_remote_presenter` MCP tool generates SSE server + client JS for HTTP-controlled slide navigation
- **Collaborative editing** — `setup_collab` MCP tool generates SSE file-watch server; multi-user design sync via `/patch` + `/events` endpoints
- **Modular architecture** — thin MCP wrappers, zero domain logic in servers; all business logic in `engine.ts`

---

## Deployment Overview

| Mode | Best for | Transport | Auth | Editor |
|---|---|---|---|---|
| **Local stdio (LM Studio / Claude Code)** | Single user, model running on your laptop | stdio | none (process-local) | `npm run dev` separately |
| **Local Docker** | Single user, want everything in one container | HTTP + SSE on `localhost` | tokens optional | bundled at `:4173` |
| **VPS Docker (plain HTTP)** | Behind your own nginx/Cloudflare Tunnel | HTTP + SSE on a port | tokens **required** | bundled at `:4173` |
| **VPS Docker + Caddy** | Public deploy, Claude.ai Custom Connector, multi-client | HTTPS auto-cert | tokens **required** | `https://your-domain/` |

All four use the same Folio binary. Pick the mode that matches your situation and use the matching section below.

---

## Local — LM Studio (stdio)

This is the original mode: LM Studio launches Folio as a subprocess, talks to it over stdio, and your designs land in `~/.folio/projects/` on the host.

### Requirements

- **Git** — `git --version`
- **Bun 1.0+** — `bun --version` ([install guide](https://bun.sh/docs/installation))
- **LM Studio** with a model that supports tool calling (Gemma 4B, Qwen 3.5, etc.)

### Platform support

| Platform | Status |
|---|---|
| Windows | Verified on Windows 11 |
| macOS | CI/CD pipeline passes |
| Linux | Verified end-to-end |

### First run

The first launch clones the repo and installs dependencies (~1–2 minutes). Subsequent launches are instant.

> **Pre-install recommended (Windows):** To avoid the LM Studio connection timeout on first launch, run this once in PowerShell before connecting:
> ```powershell
> $d = Join-Path $env:USERPROFILE '.mcp_servers\Folio'
> git clone https://github.com/azzindani/Folio.git $d --quiet
> Set-Location $d; bun install --frozen-lockfile
> ```
> If you skip this and LM Studio times out, press **Restart** in the MCP Servers panel — it will reconnect and complete the install.

### Windows (PowerShell)

1. Open LM Studio → **Developer** tab (`</>`) or find it via **Integrations**
2. Find **mcp.json** or **Edit mcp.json** → click to open
3. Paste this config:

```json
{
  "mcpServers": {
    "folio_basic": {
      "command": "powershell",
      "args": [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='1'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_design": {
      "command": "powershell",
      "args": [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='2'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_export": {
      "command": "powershell",
      "args": [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$d = Join-Path $env:USERPROFILE '.mcp_servers\\Folio'; $g = Join-Path $d '.git'; if (!(Test-Path $g)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; git clone https://github.com/azzindani/Folio.git $d --quiet } else { Set-Location $d; git fetch origin --quiet; git reset --hard FETCH_HEAD --quiet }; Set-Location $d; bun install --frozen-lockfile --quiet; $env:FOLIO_MCP_TIER='3'; bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    }
  }
}
```

4. Wait for the green dot next to each server
5. Start chatting — the model will see all 49 tools

> For small models (≤32K context), use only `folio_basic` (15 tools). For 64K+ models, add `folio_design`. For 128K models, all three.

### macOS / Linux (bash)

```json
{
  "mcpServers": {
    "folio_basic": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=1 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_design": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=2 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    },
    "folio_export": {
      "command": "bash",
      "args": [
        "-c",
        "d=\"$HOME/.mcp_servers/Folio\"; if [ ! -d \"$d/.git\" ]; then rm -rf \"$d\"; git clone https://github.com/azzindani/Folio.git \"$d\" --quiet; else cd \"$d\" && git fetch origin --quiet && git reset --hard FETCH_HEAD --quiet; fi; cd \"$d\"; bun install --frozen-lockfile --quiet; FOLIO_MCP_TIER=3 bun run src/mcp/index.ts"
      ],
      "env": { "FOLIO_OUTPUT_BUDGET": "1000" },
      "timeout": 600000
    }
  }
}
```

---

## Local — Docker

For when you want the bundled editor + MCP HTTP API in one container on your laptop.

```bash
git clone https://github.com/azzindani/Folio.git
cd Folio
cp .env.example .env
cp tokens.example.json tokens.json    # edit and replace the placeholder values
docker compose up -d --build
```

This brings up a single `folio` container:

| URL | What it serves |
|---|---|
| `http://localhost:4173/` | Visual editor |
| `http://localhost:3333/mcp` | MCP JSON-RPC endpoint |
| `http://localhost:3333/mcp/sse` | Tool-result SSE stream |
| `http://localhost:3333/editor/events` | File-change SSE for live editor refresh |
| `http://localhost:3333/health` | Liveness (no auth) |
| `http://localhost:3333/tokens/whoami` | Returns the token name accepted on this request |

Designs persist to `./folio-projects` on the host. Tear down with `docker compose down`; restart with `docker compose up -d`.

---

## VPS / Self-hosted Production

For exposing Folio publicly so Anthropic Custom Connectors, remote Claude Code instances, Hermes, OpenClaw, or any other MCP-over-HTTP client can reach it.

### One-time setup

1. **Point DNS at your VPS.** Create an `A` record: `folio.your-domain.tld → <vps-ip>`. Wait for it to propagate.
2. **Install Docker + Compose on the VPS** (any modern Linux distro).
3. **Clone and configure:**
   ```bash
   git clone https://github.com/azzindani/Folio.git
   cd Folio
   cp .env.example .env
   cp tokens.example.json tokens.json
   ```
4. **Edit `.env`:**
   ```ini
   FOLIO_DOMAIN=folio.your-domain.tld
   FOLIO_ACME_EMAIL=you@your-domain.tld
   FOLIO_MODE=both
   FOLIO_TOKENS_FILE=/home/folio/tokens.json
   ```
5. **Edit `tokens.json`** — replace every placeholder with a long random string (`openssl rand -hex 32`). Keep this file out of git; `.gitignore` already excludes it.
6. **Bring up the stack with TLS:**
   ```bash
   docker compose --profile tls up -d --build
   ```

Caddy will request a Let's Encrypt certificate for `FOLIO_DOMAIN` and start terminating HTTPS in under a minute. Confirm:

```bash
curl -fsS https://folio.your-domain.tld/health
# → {"status":"ok","version":"1.0.0","tiers":["1","2","3"],"auth":"multi"}

curl -H "Authorization: Bearer <one-of-your-tokens>" \
     https://folio.your-domain.tld/tokens/whoami
# → {"token":"claude-desktop","auth_mode":"multi"}
```

### Updating

```bash
git pull
docker compose --profile tls up -d --build
```

The build runs unit + integration tests by default. If you want a quick redeploy, set `FOLIO_SKIP_TESTS=1` in `.env`.

### Backups

The only state lives in `./folio-projects` (designs, tasks, exports) and `./tokens.json`. Both are plain files — back them up with whatever you already use (rsync, restic, borg, …).

---

## Auth & Tokens

Three modes; the first one that resolves wins:

| Mode | Env / file | When to use |
|---|---|---|
| Multi-token from file | `FOLIO_TOKENS_FILE=/path/tokens.json` | Production. Each client gets a named token. |
| Multi-token inline | `FOLIO_TOKENS="claude:sk-aaa,hermes:sk-bbb"` | Env-only deploys (no file mount). |
| Single shared key | `FOLIO_API_KEY=sk-...` | Legacy / single client. |
| Open | none set | Localhost-only / private network. |

### Format of `tokens.json`

```json
{
  "claude-desktop": "sk-folio-7f9c4...long-random...",
  "claude-code":    "sk-folio-3a1b2...long-random...",
  "hermes":         "sk-folio-d8e7f...long-random..."
}
```

The **key** is the token name (shown in the audit log). The **value** is the bearer string the client sends as `Authorization: Bearer <value>`.

### Generating strong tokens

```bash
openssl rand -hex 32         # → 64 hex chars, recommended
# or
python3 -c "import secrets; print('sk-folio-' + secrets.token_urlsafe(32))"
```

### Audit log

Every authenticated `tools/call` writes one line to stderr:

```
[mcp] token=claude-desktop tool=create_design ok=true
```

Tail it with `docker compose logs -f folio` to see which connector is doing what. Token *values* are never logged.

### Rotating a token

1. Add a new entry to `tokens.json` (`"claude-desktop-v2": "sk-new..."`).
2. `docker compose restart folio` (≤1 s downtime).
3. Switch the client to the new token.
4. Remove the old entry; restart again.

---

## Connecting MCP Clients

All HTTP clients talk to the same JSON-RPC endpoint:

```
POST  https://your-domain/mcp
GET   https://your-domain/mcp/sse        ← optional SSE stream of tool results
Auth: Authorization: Bearer <token>
```

`tools/list`, `tools/call`, and `initialize` follow the standard MCP wire protocol — no Folio-specific extensions.

The `/mcp` endpoint implements the **Streamable HTTP** transport per the MCP spec, so strict MCP SDK clients connect cleanly:

| Request | Response |
|---|---|
| `POST /mcp` (a request with `id`) | `200` + JSON-RPC reply |
| `POST /mcp` (a `notifications/*` message) | `202 Accepted`, empty body |
| `GET` / `DELETE /mcp` | `405` + `Allow: POST` (server is stateless — no server→client stream or session) |

If a client errors on the `GET`/notification behavior it predates the current spec — bridge it with `mcp-remote` (see [LM Studio over HTTP](#lm-studio-over-http--drive-a-docker-hosted-folio-with-a-local-model)).

### Anthropic Claude Connectors (claude.ai)

1. Go to **Settings → Connectors → Add custom connector**.
2. URL: `https://folio.your-domain.tld/mcp`
3. Auth: **Bearer token**, value from `tokens.json`.
4. Save. Claude.ai will run `tools/list` and surface all 49 tools.

> The full claude.ai OAuth + PKCE walkthrough is in [docs/INTEGRATIONS.md §2](docs/INTEGRATIONS.md).

> Anthropic's connector requires HTTPS. Use the Caddy TLS profile (above) or front Folio with Cloudflare Tunnel / nginx + Let's Encrypt.

### Claude Code (`mcp.json`)

For the Claude Code CLI, either point at your hosted instance OR use the local stdio config from the LM Studio section.

Hosted (HTTP transport):

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

### LM Studio over HTTP — drive a Docker-hosted Folio with a local model

LM Studio supports HTTP MCP servers since v0.3, so a model running locally in LM Studio can drive a Folio that's already up in Docker (on your laptop or a VPS) — no stdio subprocess, no second clone of the repo.

**LM Studio → Developer (`</>`) → Edit `mcp.json`** and paste this, pointing `url` at your Docker endpoint:

```json
{
  "mcpServers": {
    "folio": {
      "url": "https://folio.casava.space/mcp",
      "headers": { "Authorization": "Bearer <YOUR_FOLIO_TOKEN>" }
    }
  }
}
```

Swap the `url` + bearer for your own deployment:

| Where Folio runs | `url` | Token |
|---|---|---|
| Hosted (VPS + Caddy TLS) | `https://folio.your-domain.tld/mcp` | a value from `tokens.json`, or your `FOLIO_API_KEY` |
| Local Docker (`docker compose up`) | `http://localhost:3333/mcp` | optional on localhost — drop `headers` entirely if no auth is set |

One HTTP endpoint exposes **all 49 tools** (no tier split over HTTP). Designs the model creates land in the container's `/home/folio/projects` (host `./folio-projects`) and open in the bundled editor at the same host — `https://folio.your-domain.tld/` or `http://localhost:4173/`.

> Smoke-test the endpoint before wiring it into LM Studio:
> ```bash
> curl -s https://folio.casava.space/mcp \
>   -H "Authorization: Bearer <YOUR_FOLIO_TOKEN>" \
>   -H "Content-Type: application/json" \
>   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'   # → 49
> ```
> If the curl prints `49` but LM Studio still won't connect, it's the client, not the server — use the stdio bridge below.

#### If LM Studio won't connect over HTTP — stdio bridge fallback

Older LM Studio builds (and some other clients) don't speak remote/HTTP MCP, or their HTTP transport is finicky. The reliable workaround is [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) — a tiny stdio↔HTTP proxy LM Studio launches as a normal `command`, so from LM Studio's side it's a local stdio server while it talks to your Docker endpoint underneath. Needs Node.js on the machine.

```json
{
  "mcpServers": {
    "folio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://folio.casava.space/mcp",
        "--header", "Authorization:Bearer ${FOLIO_TOKEN}"
      ],
      "env": { "FOLIO_TOKEN": "<YOUR_FOLIO_TOKEN>" }
    }
  }
}
```

> Why this works when the direct config doesn't: `mcp-remote` runs the full MCP SDK client itself and handles the Streamable-HTTP handshake, auth header, and reconnects — LM Studio only has to do stdio, which every version supports. (The Folio server is spec-compliant either way: `GET /mcp` → 405, `notifications/*` → 202; if a client trips on those, it's out of date.)

### Hermes, OpenClaw, and other MCP-over-HTTP agents

Any client that speaks JSON-RPC over HTTP with a bearer header works. Minimal config shape:

```yaml
mcp_servers:
  folio:
    transport: http
    url: https://folio.your-domain.tld/mcp
    auth:
      type: bearer
      token: sk-folio-hermes-...
```

### Smoke-test with curl

```bash
# 1. Health (no auth)
curl -s https://folio.your-domain.tld/health | jq .

# 2. Who am I? (auth)
curl -s https://folio.your-domain.tld/tokens/whoami \
     -H "Authorization: Bearer sk-folio-..." | jq .

# 3. tools/list (returns all 49 tool definitions)
curl -s https://folio.your-domain.tld/mcp \
     -H "Authorization: Bearer sk-folio-..." \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# → 49

# 4. Create a project
curl -s https://folio.your-domain.tld/mcp \
     -H "Authorization: Bearer sk-folio-..." \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_project","arguments":{"project_path":"/home/folio/projects/test","name":"test"}}}'
```

---

## Visual Editor

Folio ships a full browser-based design editor at `http://localhost:4173` (Docker) or `npm run dev` for local dev (`http://localhost:5173`). It operates on the same `.design.yaml` files the MCP server reads and writes — no conversion step.

When deployed behind Caddy it's reachable at `https://your-domain/`. The editor opens an SSE connection to `/editor/events` and reloads the active design the moment an MCP tool mutates it, so you can run the LLM in one tab and watch its changes paint in the next.

### Canvas

| Capability | Detail |
|---|---|
| Render engine | SVG-in-HTML — vector-native, pixel-perfect at any zoom |
| Layer selection | Click to select; Shift+click to add; drag on empty canvas for rubber-band multi-select |
| Move | Drag any selected layer; arrow keys for 1px nudge |
| Resize | 8-point handles; Shift to constrain aspect ratio |
| Rotate | Dedicated handle above selection box; Shift to snap to 15° |
| Flip | Horizontal and vertical flip via Transform panel |
| Group | Ctrl+G to group; Ctrl+Shift+G to ungroup; resize scales children |
| Lock | Lock/Unlock toggle in Transform panel — locked layers cannot be dragged or resized |
| Zoom | Ctrl+scroll or pinch; Ctrl+0 to fit canvas |
| Pan | Space+drag or middle-mouse drag |
| Guides | Drag from rulers to place snap guides |
| Grid | G to toggle; configurable columns, gutter, baseline |
| Annotations | Alt+hover shows distance between selected layer and hovered layer |

### Panels

| Panel | Function |
|---|---|
| Layer panel | All layers grouped by z-band (background / structural / content / overlay / foreground); virtual scroll handles 200+ layers; click to select, drag to reorder |
| Properties panel | Position, size, fill, stroke, effects, transform (z / opacity / rotation / flip), blend mode — all fields live-update the canvas |
| Problems panel | Validation errors and warnings with layer ID and message; click to select the offending layer |
| File tree | Browse and open `.design.yaml`, `.template.yaml`, `.component.yaml` files |
| Page strip | Carousel page thumbnails — click to navigate, drag to reorder |
| Payload editor | Monaco YAML editor (VS Code engine) with inline validation, syntax highlighting, and bidirectional sync with the canvas |
| Command palette | Ctrl+K or `/` — search and execute any action by name |
| Align toolbar | Align left/center/right/top/middle/bottom; distribute horizontally/vertically; match width/height |

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `T` | Text tool |
| `L` | Line tool |
| `G` | Toggle grid |
| `Ctrl+K` / `/` | Command palette |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+D` | Duplicate selected layer(s) |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste as YAML |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
| `Ctrl+[` / `Ctrl+]` | Send backward / Bring forward |
| `Ctrl+0` | Fit canvas to screen |
| `Ctrl+S` | Save file |
| `Delete` | Delete selected layer(s) |

### Export (from editor)

| Format | Notes |
|---|---|
| SVG | Vector, lossless, opens in any browser |
| PNG ×1 / ×2 / ×3 | Up to 3240×3240 px — retina quality |
| PDF | Client-side via jsPDF |
| HTML | Self-contained — all assets and YAML embedded inline |

---

## Design Engine

The engine is the layer between the YAML file and the rendered SVG. It runs in both the browser (for the visual editor) and Bun/Node (for MCP export). Every design is a `.design.yaml` file — the canvas is a live view, never the source of truth.

### Layer Types

| Type | Capabilities |
|---|---|
| `rect` | Fill (solid / linear / radial / conic / noise gradient), stroke, border radius (uniform or per-corner), shadow, opacity, flip, rotation |
| `circle` / `ellipse` | Same fill and stroke options as rect |
| `text` | Plain, markdown (via marked.js), or rich (inline spans); word-wrap by layer width; left/center/right align; vertical align (top/middle/bottom); underline/strikethrough; letter spacing; line height |
| `line` | Stroke color, width, dash pattern, linecap, linejoin |
| `path` | SVG bezier path (`d` attribute), fill + stroke |
| `icon` | 80+ Lucide icons by name (e.g. `"star"`, `"arrow-right"`, `"lock"`) — rendered as inline SVG |
| `image` | Raster or SVG; `src` accepts file path or data URL; optional SVG recolor |
| `group` | Arbitrary nesting; resize scales all children proportionally |
| `auto_layout` | Flexbox-like frame: `direction` (row/column), `gap`, `padding`, `align_items`, `justify_content`, `wrap` |
| `mermaid` | Mermaid diagram DSL rendered as SVG (lazy loaded) |
| `chart` | Vega-Lite JSON spec rendered as interactive chart (lazy loaded) |
| `code` | Syntax-highlighted code block via Prism (lazy loaded) |
| `math` | KaTeX math expression (lazy loaded) |
| `component` | Reference to a `.component.yaml` — resolved and inlined at render time |
| `qrcode` | QR code generated client-side with no external dependencies |

### Fill Types

```yaml
fill: { type: solid,  color: "$primary" }
fill: { type: linear, angle: 135, stops: [{color: "#1A1A2E", position: 0}, {color: "#16213E", position: 100}] }
fill: { type: radial, cx: 50, cy: 50, radius: 70, stops: [...] }
fill: { type: conic,  angle: 0, stops: [...] }
fill: { type: noise,  base_color: "#1A1A2E", intensity: 0.3 }
fill: { type: none }
```

### Effects

| Effect | Rendered as |
|---|---|
| Drop shadow | SVG `feDropShadow` (simple) or `feMorphology + feGaussianBlur + feOffset + feMerge` (with spread) |
| Blur | SVG `feGaussianBlur` on SourceGraphic |
| Opacity | SVG `opacity` attribute |
| Blend mode | CSS `mix-blend-mode` |
| Rotation | SVG `rotate(deg cx cy)` transform |
| Flip H / Flip V | SVG `translate + scale(-1,1) + translate` transform |

### Theme Tokens

Prefix any color or font value with `$` to reference the active theme:

```yaml
color:       "$primary"      # → theme.colors.primary
fill:        "$surface"      # → theme.colors.surface
font_family: "$heading"      # → theme.typography.families.heading
color:       "$text_muted"   # → theme.colors.text_muted
```

Built-in themes: `dark-tech` (dark indigo/red), `light-clean` (white/blue). Custom themes defined in `themes/` and registered in `project.yaml`.

### Z-Index Bands

```
0–9    Background   — full-bleed fills, textures
10–19  Structural   — cards, frames, containers
20–49  Content      — text, icons, images, charts
50–69  Overlay      — color washes, decorative overlays
70–89  Foreground   — accent shapes, highlights
90–99  UI           — editor-only handles (never written to files)
```

### Design File Format

```yaml
_protocol: "design/v1"
_mode: complete         # draft | complete

meta:
  id: my-poster
  name: My Poster
  type: poster          # poster | carousel
  created: "2026-04-28"
  modified: "2026-04-28"

document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96

theme:
  ref: dark-tech

layers:
  - id: bg
    type: rect
    z: 0
    x: 0
    y: 0
    width: 1080
    height: 1080
    fill: { type: linear, angle: 135, stops: [{color: "$background", position: 0}, {color: "$surface", position: 100}] }

  - id: headline
    type: text
    z: 20
    x: 80
    y: 400
    width: 920
    height: auto
    content: { type: plain, value: "Hello, Folio!" }
    style:
      font_family: "$heading"
      font_size: 80
      font_weight: 800
      color: "$text"
      align: center
      line_height: 1.1
```

---

## Important: Absolute Paths

> **Always pass absolute paths to `project_path` and `design_path`.**
>
> Stdio MCP servers resolve paths from their own working directory. HTTP MCP servers resolve from the container's filesystem — `~` and `$HOME` mean `/home/folio` inside the container, not your laptop.
>
> Inside Docker, the canonical project root is `/home/folio/projects`. So:
> ```
> Create a design in /home/folio/projects/my-poster
> ```
> On the host, that same directory is `./folio-projects/my-poster`.
>
> Outside Docker (LM Studio stdio):
> ```
> Create a design in C:\Users\you\designs\my-project   # Windows
> Create a design in /Users/you/designs/my-project     # macOS/Linux
> ```

The MCP path-resolver gates every read/write to the calling user's home directory or `/tmp`. Paths outside that are rejected.

---

## Available Tools

### Tier 1 — Basic (15 tools)

Project management, navigation, task planning, and library/theme ops. Safe to use with any model — minimal token cost.

| Tool | Purpose |
|---|---|
| `get_engine_guide` | Load engine reference guide by section: `quick_ref`, `shorthand`, `layers`, `workflow`, `reference` (~200 tokens each) |
| `enrich_brief` | Turn a short/vague prompt into a rich content plan (best preset + outline, or a per-page carousel plan) — start here when the brief is thin |
| `create_project` | Scaffold project directory with `designs/`, `assets/`, `themes/`, `exports/` and `project.yaml` |
| `list_designs` | List all `.design.yaml` files in a project with status and page count |
| `browse_library` | Cross-project catalog of the whole library — every project + design, newest first |
| `rename_design` | Change a design's display name (file path left unchanged so editor links survive) |
| `delete_design` | Move a design to the project's `.trash/` (recoverable) |
| `move_design` | Move a design's file into another project |
| `list_tasks` | List task files with progress status (pages done / total) |
| `list_themes` | List available themes registered in `project.yaml` |
| `apply_theme` | Set active theme for a project — updates `project.yaml` |
| `duplicate_design` | Copy a design with a new name and fresh UUID — registers in `project.yaml` |
| `create_task` | Plan a multi-page carousel — scaffolds task file and first design, returns first `append_page` baton |
| `resume_task` | Read task state and return exact next tool call — use after any context reset |
| `resume_design` | Read carousel generation state to continue appending pages |

### Tier 2 — Design (10 tools)

Full design lifecycle — create, inspect, build, edit. All write tools create a `.mcp_versions/` snapshot before touching disk.

| Tool | Purpose |
|---|---|
| `create_design` | Create a new blank `.design.yaml` (poster or carousel) registered in `project.yaml` |
| `extract_reference` | Turn a reference image (Canva export / screenshot / SVG) into a palette + canvas + composition brief |
| `inspect_design` | Return design metadata, layer summary, page list, and validation errors |
| `add_layers` | Add one or more layers using shorthand syntax — 80% fewer tokens than verbose YAML |
| `append_page` | Add a page to a carousel design; returns next `append_page` baton or `seal_design` when done |
| `add_layer` | Add a single layer by ID — surgical insert without replacing others |
| `update_layer` | Update specific fields on an existing layer by ID |
| `remove_layer` | Remove a layer by ID |
| `patch_design` | Apply JSON-pointer selectors to any field; supports `dry_run: true` to validate before writing |
| `seal_design` | Mark design complete, validate all layers, freeze `_mode: complete` |

### Tier 3 — Export (24 tools)

SVG/HTML/PNG export, batch generation, templates, component extraction, report assembly, presentations, formula binding, animation, collaboration, and QA (diagnose / preview / align).

| Tool | Purpose |
|---|---|
| `open_in_editor` | Return a `http://…/?file=…&mcp_url=…` URL that opens the design in the visual editor with live MCP refresh wired up |
| `export_design` | Export to SVG/PNG (server-side jsdom renderer) or self-contained HTML; PDF stages HTML for Puppeteer |
| `export_library_gallery` | Build a self-contained `library.html` file-manager (thumbnails + search + editor links) for the whole library |
| `diagnose_design` | Scan for issues the model is blind to — off-canvas, collisions, misalignment, invisible/low-contrast text, weak hierarchy — each with a fix |
| `render_preview` | Render to a PNG and return it inline as an image so the model can *see* the result |
| `align_layers` | Auto-align / distribute / snap-to-grid a set of layers — the fix for diagnose misalignment findings |
| `validate_report` | Lint an interactive report's cross-references (datasets, fields, actions) before export |
| `export_template` | Export sealed design as `.template.yaml` skeleton with named `{{slot}}` placeholders |
| `list_template_slots` | List all injectable slots in a `.template.yaml` with paths, types, and hints |
| `inject_template` | Fill template slots with new content to produce a `.design.yaml` |
| `batch_create` | Generate N designs from one template using an array of slot objects |
| `save_as_component` | Extract selected layers into a `.component.yaml` and replace with a component instance |
| `generate_report` | Scaffold a `report`-type design with pages, navigation (sidebar/topbar/tabs/dots), and optional data sources |
| `bind_data` | Attach or update inline datasets on a report design; fields support `$data.*` / `$agg.*` expressions |
| `export_report` | Assemble a report design into a self-contained interactive HTML file with navigation runtime |
| `create_presentation` | Scaffold a 1920×1080 presentation design with slides, 17 transition types, and presenter settings |
| `export_presentation` | Assemble presentation into self-contained HTML with keyboard nav, touch swipe, teleprompter, and audio |
| `set_formula_context` | Persist state/data context for `=expression` formula bindings on a design |
| `debug_formula` | Evaluate a `=expression` against a given context and return result with type info |
| `inspect_timeline` | Show animation keyframe tracks for a design as ASCII timeline |
| `add_keyframe` | Add or replace a keyframe on a layer's animation timeline |
| `export_animation` | Export presentation as GIF/MP4/WebM (Puppeteer frame capture + ffmpeg encoding when available) |
| `setup_remote_presenter` | Generate SSE remote clicker: client JS snippet + curl commands for HTTP-controlled slide navigation |
| `setup_collab` | Generate SSE collaborative editing server: file-watch + `/patch` + `/events` endpoints for multi-user sync |

---

## Workflow Reference

### Poster (single page)

```
1. create_project  → project scaffold
2. create_design   → blank .design.yaml
3. add_layers      → layers_shorthand=[{id,type,z,pos,fill,...}]
4. seal_design     → validate + freeze
5. export_design   → format: svg
```

### Carousel (multi-page)

```
1. create_project  → project scaffold
2. create_task     → plan pages=[{label,hints}], returns first append_page baton
3. append_page     → add layers for page 1; repeat until remaining==0
4. seal_design     → validate + freeze
5. export_design   → format: svg
```

### Report (interactive HTML document)

```
1. generate_report  → scaffold report .design.yaml (pages, nav, layout)
2. bind_data        → attach inline datasets for $data.* / $agg.* expressions
3. append_page      → add layers to each page (supports data-driven layers)
4. seal_design      → validate + freeze
5. export_report    → assemble self-contained .report.html with nav runtime
```

The exported HTML is fully self-contained — one file, no external dependencies. Navigation, page switching, and data bindings are powered by a 2 KB inline runtime (`window.Folio.nav`). Supports sidebar, topbar, tabs, and dot navigation.

### Presentation (animated slide deck)

```
1. create_presentation → scaffold 1920×1080 design (slides, transitions, auto-advance)
2. append_page         → add layers to each slide
3. set_formula_context → bind state/data for =expression properties (optional)
4. add_keyframe        → add animation keyframes per layer (optional)
5. export_presentation → self-contained HTML presenter with keyboard nav + teleprompter
```

The exported HTML is fully self-contained — 17 CSS transition types, keyboard/touch nav, auto-advance timer, speaker notes, teleprompter mode, fullscreen, audio cue playback, and `window.FolioPresenter` runtime API.

### Patch (edit sealed design)

```
1. patch_design    → dry_run: true  (validate selectors)
2. patch_design    → dry_run: false (apply)
3. seal_design     → re-validate + re-freeze
```

---

## Usage Examples

### Create a poster

```
Create a project at /home/folio/projects/work, then make a dark tech poster with a bold headline and a red pill badge
```

### Build a carousel

```
Plan a 5-slide product launch carousel at /home/folio/projects/launch — cover, problem, solution, features, CTA
```

### Resume after context reset

```
Resume the task at /home/folio/projects/launch/tasks/product-launch.task.yaml
```

### Export as SVG

```
Export /home/folio/projects/work/designs/poster.design.yaml as SVG
```

### Batch from template

```
Generate 10 variations of the announcement template using the slots in /home/folio/projects/templates/announcement.template.yaml
```

### Patch a specific field

```
Change the headline text in /home/folio/projects/work/designs/poster.design.yaml to "Q3 Results"
```

### Open the visual editor

```bash
npm run dev   # local dev → http://localhost:5173
# or
docker compose up -d   # → http://localhost:4173
```

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `FOLIO_MODE` | `ui` (Docker default in compose: `both`) | Container role: `ui` · `mcp` · `both` |
| `FOLIO_PORT` | `3333` | MCP HTTP port (in-container) |
| `PORT` | `4173` | Visual editor port (in-container) |
| `FOLIO_PROJECTS_DIR` | `/home/folio/projects` | Where designs live inside the container |
| `FOLIO_OUTPUT_BUDGET` | `1000` | Max tokens per MCP tool response |
| `FOLIO_MCP_TIER` | `1` | stdio mode only: `1` basic, `2` basic+design, `3` all |
| `MCP_CONSTRAINED_MODE` | `false` | Set `true` to reduce result sizes for low-RAM machines |
| `FOLIO_TOKENS_FILE` | unset | Path to JSON file of named tokens (highest priority) |
| `FOLIO_TOKENS` | unset | Inline tokens `"name1:val1,name2:val2"` |
| `FOLIO_API_KEY` | unset | Single shared bearer (legacy) |
| `FOLIO_DOMAIN` | unset | Public hostname for the Caddy TLS profile |
| `FOLIO_ACME_EMAIL` | unset | Let's Encrypt registration email |
| `FOLIO_SKIP_TESTS` | `0` | Set `1` to skip the test suite during `docker build` |
| `FOLIO_UI_PORT` | `4173` | Compose: host port mapped to the editor |
| `FOLIO_MCP_PORT` | `3333` | Compose: host port mapped to MCP HTTP |

### Token budget

Set `FOLIO_OUTPUT_BUDGET` to cap tool response size in tokens. Default is `1000`. When a response exceeds the budget, least-critical fields are trimmed first (artifact paths → extra suggested tools → extra progress items → backup full path).

### Constrained mode

Set `MCP_CONSTRAINED_MODE=true` to reduce result set sizes for lower-memory machines. This halves list row limits, layer row limits, and search result counts.

---

## Uninstall

### LM Studio (stdio install)

**Step 1:** Remove from your MCP client — delete all `folio_*` entries from `mcp.json` and restart the client.

**Step 2:** Delete installed files.

Windows PowerShell:
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.mcp_servers\Folio"
Remove-Item -Recurse -Force "$env:USERPROFILE\.folio"
```

macOS / Linux:
```bash
rm -rf ~/.mcp_servers/Folio
rm -rf ~/.folio
```

### Docker

```bash
docker compose --profile tls down -v   # also removes caddy_data / caddy_config
docker rmi folio:latest
# Optional: also delete persisted designs
rm -rf ./folio-projects
```

---

## Architecture

```
Folio/
├── src/
│   ├── mcp/
│   │   ├── index.ts             ← stdio entry point; selects tier via FOLIO_MCP_TIER (1|2|3|all)
│   │   ├── http-server.ts       ← HTTP + SSE transport (used by Docker); serves all 49 tools
│   │   ├── handlers.ts          ← ALL_HANDLERS = TIER1∪TIER2∪TIER3 (single dispatch map)
│   │   ├── auth.ts              ← token loader (file / inline / single-key / open)
│   │   ├── jwt.ts               ← HS256 editor-link JWTs + master bearer
│   │   ├── oauth.ts             ← OAuth 2.0 + PKCE + DCR + refresh (claude.ai connector)
│   │   ├── engine.ts            ← facade → engine-{project,layer,edit,export,report,runtime}-tools.ts
│   │   ├── types.ts             ← ToolResult, ProgressItem, Handover, ContextField
│   │   ├── shorthand-parser.ts  ← facade → shorthand-{helpers,presets,sections,background,expand,…}.ts
│   │   ├── engine/
│   │   │   ├── utils.ts         ← resolvePath, snapshot, readYAML, writeYAML, okResult, errResult
│   │   │   ├── guide.ts         ← 5-section engine reference guide (~200 tokens/section)
│   │   │   ├── svg-export.ts    ← server-side SVG renderer (jsdom + renderer.ts)
│   │   │   ├── task.ts          ← carousel task file CRUD + next-action baton
│   │   │   └── coerce.ts        ← input coercion helpers
│   │   ├── tier1/               ← Basic tool registry + stdio server
│   │   ├── tier2/               ← Design tool registry + stdio server
│   │   ├── tier3/               ← Export tool registry + stdio server
│   │   └── all/                 ← full-union registry + stdio server (FOLIO_MCP_TIER=all)
│   ├── renderer/
│   │   ├── renderer.ts          ← renderDesign() / renderPage() → SVGSVGElement
│   │   ├── layer-renderers.ts   ← per-type renderers
│   │   ├── fill-renderer.ts     ← solid, linear, radial, conic, noise gradient fills
│   │   ├── effects-renderer.ts  ← drop shadow (with spread), blur, blend mode
│   │   ├── svg-utils.ts         ← createSVGElement, getOrCreateDefs, uniqueDefId
│   │   ├── lucide-icons.ts      ← 80+ Lucide icon SVG paths
│   │   └── qr/                  ← QR code encoder (no external deps)
│   ├── schema/                  ← types + parser + validator + template
│   ├── engine/                  ← token-resolver + shorthand-expander + component-resolver
│   ├── editor/                  ← browser visual editor (canvas, state, interactions)
│   ├── ui/                      ← panels, toolbar, command palette
│   ├── export/                  ← SVG / HTML / PDF / animation / collab / remote-clicker
│   ├── themes/                  ← built-in theme definitions
│   └── utils/                   ← debug logger, ruler units
├── scripts/
│   ├── docker-entrypoint.sh     ← dispatches by $FOLIO_MODE
│   ├── serve.sh                 ← editor static server: bun src/editor/static-server.ts (:4173)
│   ├── serve-mcp.sh             ← bun run src/mcp/http-server.ts (:3333)
│   ├── build.sh · test.sh       ← used by both host + Docker
├── caddy/Caddyfile              ← reverse proxy + auto-HTTPS for the tls profile
├── docker-compose.yml           ← folio + optional caddy service
├── Dockerfile                   ← oven/bun:1-alpine, two-stage
├── .env.example                 ← env template
├── tokens.example.json          ← multi-token template
├── tests/                       ← Playwright e2e + visual regression
└── src/**/*.test.ts             ← 2,900+ Vitest unit + integration tests
```

---

## Development

### Local

```bash
# Install dependencies (bun is faster)
bun install

# Visual editor + HMR
npm run dev                       # → http://localhost:5173

# MCP stdio
FOLIO_MCP_TIER=3 bun run src/mcp/index.ts

# MCP HTTP (auth optional)
FOLIO_API_KEY=sk-dev bun run src/mcp/http-server.ts

# Unit + integration tests
npm run test:unit

# Coverage
npm run test:coverage

# Type check + lint (zero-warning policy)
npm run typecheck && npm run lint

# E2E (build first)
npm run build && npm run test:e2e
```

### Continuing development on the VPS

The image is built from sources, so editing files inside the cloned repo and re-running `docker compose --profile tls up -d --build` is the supported dev loop. For tighter cycles:

```bash
# Skip tests during quick iteration
FOLIO_SKIP_TESTS=1 docker compose --profile tls up -d --build

# Watch logs
docker compose logs -f folio caddy
```

---

## License

MIT
