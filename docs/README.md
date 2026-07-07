# Folio Documentation

Folio is a **local-first, file-based graphic-design engine** with an **MCP server**
front-end. An LLM (or a human in the browser editor) composes designs as plain
`.design.yaml` files; the engine compiles them to SVG / HTML / PDF / animation. The
YAML file *is* the product — the canvas and exports are regenerable views.

Because Folio speaks the **Model Context Protocol** over both stdio and HTTP, any
MCP-capable client drives it without custom code: **claude.ai** (Custom Connector),
**Claude Code**, **LM Studio**, and any harness (**Hermes**, **OpenClaw**, …) that
talks JSON-RPC over HTTP with a bearer token.

---

## The map

| Doc | What it covers | Read it when… |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture: engine core, MCP layering, data flows, render pipeline, transports/endpoints, build & test | …you want the whole-system mental model or plan to extend it |
| [MCP.md](MCP.md) | Folio as an MCP engine: standard, stdio + HTTP transports, the 3 tiers, JSON-RPC wire protocol, the handover/`next_action` contract, shorthand & presets, token budgets, workflows | …you're driving Folio from an LLM |
| [TOOLS.md](TOOLS.md) | Reference for all **21 MCP tools** — params, returns, examples | …you need a specific tool's signature |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The 4 deploy modes, Docker + Caddy/TLS, the full endpoint table, every env var, auth (multi-token / JWT / OAuth), backups, ops | …you're hosting Folio or exposing endpoints |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Connect claude.ai, Claude Code, LM Studio, Hermes/OpenClaw/any harness; the editor live-refresh wiring | …you're plugging a specific client in |
| [EDITOR.md](EDITOR.md) | The visual editor: canvas, panels, shortcuts, export, Monaco YAML, live SSE refresh, link/auth mechanics | …you (or your user) edit designs in the browser |
| [DESIGN.md](DESIGN.md) | The design system + complete `.design.yaml` payload spec, layer schema, tokens | …you're hand-authoring YAML or adding a layer type |
| [REPORT_ENGINE.md](REPORT_ENGINE.md) | Interactive flow-layout reports: components, datasets, `$data.*`/`$agg.*`, export | …you're building data-driven HTML reports |
| [UX_ROADMAP.md](UX_ROADMAP.md) | Editor feature matrix vs Figma/Photoshop/Canva; what's shipped/missing | …you're prioritizing editor work |
| [COMPARISON-OPEN-DESIGN.md](COMPARISON-OPEN-DESIGN.md) | Folio vs Open Design (nexu-io): capability map + ranked list of adaptable features (craft rulebooks, anti-slop linter, brand `DESIGN.md` systems) | …you're scoping what to borrow from the design-agent ecosystem |
| [EXPECTATIONS.md](EXPECTATIONS.md) + [expectations/](expectations/) | The product bar, per area (design quality, model support, **assets/file system**, editor, outputs, ops, testing) — 7 detailed files | …you want to know what "done" means |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Must-have / nice-to-have per area, with shipped/partial/missing state; the 21-tool constraint | …you're deciding what to build |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Expectation vs verified current condition, severity-ranked, with next actions | …you want the honest delta |
| [ROADMAP.md](ROADMAP.md) | Self-contained work packages (P1 assets → P6 release), executable by any agent without prior context | …you're picking up the work |

---

## Reading paths by audience

**LLM author / prompt engineer** → [MCP.md](MCP.md) → [TOOLS.md](TOOLS.md) →
`get_engine_guide` (in-product) → [DESIGN.md](DESIGN.md) for the payload.

**Integrator** (wiring a client) → [DEPLOYMENT.md](DEPLOYMENT.md) (stand up an
endpoint) → [INTEGRATIONS.md](INTEGRATIONS.md) (connect your client).

**Operator** (running it in prod) → [DEPLOYMENT.md](DEPLOYMENT.md) end to end
(modes, Caddy/TLS, auth, env vars, ops).

**Contributor** → [ARCHITECTURE.md](ARCHITECTURE.md) → the §10 "Extending Folio"
checklist → the [root README](../README.md) Development section.

**Planner / next-agent picking up work** → [EXPECTATIONS.md](EXPECTATIONS.md) →
[GAP-ANALYSIS.md](GAP-ANALYSIS.md) → [ROADMAP.md](ROADMAP.md) (work packages).

**Designer / editor user** → [EDITOR.md](EDITOR.md) → [DESIGN.md](DESIGN.md).

---

## At a glance

```
Transports   stdio (FOLIO_MCP_TIER=1|2|3|all)  ·  HTTP + SSE (:3333, full 21-tool union)
Tools        21 across 3 tiers — Foundation (6) · Compose (7) · Output (8)
Auth         multi-token file / inline · single key · open · JWT editor links · OAuth2+PKCE
Endpoints    POST /mcp · GET /mcp/sse · GET /editor/events · GET /health · /oauth/* · /.well-known/oauth-*
Editor       :4173 (Bun static server) · live SSE refresh · Monaco YAML · SVG/PNG/PDF/HTML export
Layer types  35+ (rect…progress) · Themes 29 (17 builtin + 12 brand) · Render SVG-in-HTML, deterministic
Deploy       Docker (oven/bun, runs from src) · optional Caddy auto-HTTPS · runs offline
```

Start at the root [README](../README.md) for install & quick start, then come here for
depth.
