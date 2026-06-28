# ARCHITECTURE.md — Folio Design Engine

> System architecture reference. Current as of v0.1.0 (post 700-line-budget split).
> Companion docs: [MCP.md](MCP.md) · [TOOLS.md](TOOLS.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [INTEGRATIONS.md](INTEGRATIONS.md) · [EDITOR.md](EDITOR.md) · [DESIGN.md](DESIGN.md) · [REPORT_ENGINE.md](REPORT_ENGINE.md)

---

## 1. WHAT FOLIO IS

Folio is a **local-first, file-based graphic-design engine**. A design is a plain
`.design.yaml` file on disk — that file *is* the product. Everything else is a view
or a tool over it.

Three usage surfaces sit on one shared engine core:

```
   LLM (via MCP)              Human (via browser)            CI / scripts
   create/edit designs        visual + YAML editor           batch / export
        │                            │                            │
        ▼                            ▼                            ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │                          ENGINE CORE                                │
  │   schema/ (types·parser·validator)   engine/ (resolve·expand)       │
  │   renderer/ (YAML → SVG)             themes/ (tokens)               │
  └───────────────────────────────────────────────────────────────────┘
        │                            │                            │
        ▼                            ▼                            ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │                       FILE LAYER (source of truth)                  │
  │   .design.yaml · .template.yaml · .component.yaml · project.yaml    │
  │   .task.yaml · .theme.yaml · exports/*.svg|html|png|pdf             │
  └───────────────────────────────────────────────────────────────────┘
```

Design principles, in priority order:

1. **The YAML file is canonical.** The canvas, the SVG, the HTML export are all
   regenerable views. Never store state only in the view.
2. **LLM-first.** The MCP tool surface and the shorthand syntax exist so a model
   can express design intent in as few tokens as possible. Verbose YAML on disk;
   compact shorthand on the wire.
3. **Offline.** Zero CDN calls at runtime after install. Fonts, icons, and the
   renderer are bundled. (Lazy renderers — mermaid/vega/katex/prism — and Chart.js
   in HTML reports are the documented exceptions.)
4. **One engine, many transports.** The same `renderDesign()` runs in the browser
   (live canvas) and in Bun/Node (server-side SVG export, no browser).

---

## 2. REPOSITORY MAP

```
Folio/
├── src/
│   ├── mcp/              ← MCP tool surface (stdio + HTTP transports)
│   ├── schema/           ← types, parser, validator
│   ├── engine/           ← token resolver, shorthand expander, component resolver
│   ├── renderer/         ← YAML → SVG render pipeline
│   ├── editor/           ← browser visual editor + static file server
│   ├── ui/               ← editor panels, dialogs, palette, toolbars
│   ├── export/           ← SVG/HTML/PDF/animation/presentation/collab/remote
│   ├── report/           ← interactive-report data loader, aggregator, binder
│   ├── animation/        ← keyframe engine, CSS generator, transitions
│   ├── scripting/        ← =formula evaluator
│   ├── fs/               ← file access + watcher (browser)
│   ├── themes/           ← 17 built-in themes
│   ├── templates/        ← starter templates
│   └── utils/            ← debug logger, http-body caps, units
├── scripts/              ← docker-entrypoint, serve, build, gen-* index builders
├── caddy/Caddyfile       ← reverse proxy + auto-HTTPS (tls profile)
├── docker-compose.yml    ← folio + optional caddy service
├── Dockerfile            ← oven/bun image, runs from source
├── docs/                 ← this directory
└── tests/                ← Playwright e2e + visual regression
```

### 2.1 The 700-line budget & facade pattern

Every file under `src/` is capped at **700 lines**, enforced in CI by an eslint
`max-lines` rule. Modules that outgrew the budget were split, and the original
path became a **thin facade** that re-exports from siblings, so the public import
API is unchanged. When editing, go to the real sibling module, not the facade:

| Facade (import path) | Real modules behind it |
|---|---|
| `src/mcp/engine.ts` | `engine-{project,layer,edit,export,report,runtime}-tools.ts` + `engine-finalize-{geom,text}.ts` |
| `src/mcp/shorthand-parser.ts` | `shorthand-{helpers,presets-a,presets-b,sections,background,expand,recover,diagnose}.ts` |
| `src/renderer/layer-renderers.ts` | `layer-renderers-{shared,shapes,embed,layout}.ts` |
| `src/schema/types.ts` | `types/{primitives,layers,document}.ts` (barrel) |

Stateful editor/UI classes were split with an **abstract base class** the public
class `extends`: `editor/canvas.ts` → `canvas-{base,interactions,draw}.ts`;
`editor/app.ts` → `app-base.ts` + `sample-design.ts`;
`ui/panels/properties-panel.ts` → `-base`; `ui/dialogs/catalog.ts` → `catalog-base` + `catalog-utils`.

---

## 3. THE MCP SUBSYSTEM (`src/mcp/`)

This is the heart of the LLM integration story. See [MCP.md](MCP.md) for the wire
protocol and [TOOLS.md](TOOLS.md) for every tool.

### 3.1 Layering — zero domain logic in transports

```
   stdio transport                 HTTP transport
   index.ts (tier select)          http-server.ts (all tiers + OAuth + SSE)
   tier1/server.ts                       │
   tier2/server.ts                       │
   tier3/server.ts                       │
   all/server.ts                         │
        │                                │
        └──────────────┬─────────────────┘
                       ▼
              handlers.ts  ── ALL_HANDLERS = { ...TIER1_HANDLERS,
                                               ...TIER2_HANDLERS,
                                               ...TIER3_HANDLERS }
                       │  (single source of truth — dispatch ≡ advertised schema)
                       ▼
              engine.ts (facade)  →  engine-*-tools.ts
                       │
        ┌──────────────┼───────────────────────────────┐
        ▼              ▼                                 ▼
  shorthand-parser   engine/utils.ts                engine/svg-export.ts
  (shorthand→Layer)  (resolvePath·snapshot·          (jsdom + renderer.ts →
                      readYAML·writeYAML)             real .svg, no browser)
```

The transports contain **no** design logic. They parse a request, look up a handler
in `ALL_HANDLERS`, call it, and serialize the result. All business logic lives in
the engine modules. This is why a tool registered in a tier registry but missing
from `ALL_HANDLERS` would advertise but 404 — the map is deliberately the one
source of truth (`http-server.ts §1`).

### 3.2 Tiers

Tools are grouped into three tiers so a small local model can load only what it can
handle. The HTTP server always serves the full union (21); only stdio is tiered.

| Tier | Name | Count | Registry | Purpose |
|---|---|---|---|---|
| 1 | Basic | 15 | `tier1/registry.ts` | Projects, navigation, tasks, library, theming — no heavy writes |
| 2 | Design | 10 | `tier2/registry.ts` | Full design lifecycle: create → compose → inspect → patch → seal |
| 3 | Export | 24 | `tier3/registry.ts` | SVG/HTML/PDF export, templates, components, reports, presentations, animation, formula, collab |

`FOLIO_MCP_TIER` selects the stdio surface: `1`, `2`, `3`, or `all`/`0` (full union
in one registration). `index.ts` dispatches; tiers are exclusive (register 1+2+3 as
three servers for the union without dupes, or `all` for one).

### 3.3 Tool result contract

Every handler returns a `ToolResult` (see `src/mcp/types.ts`) that is far richer
than a bare string — this is what makes Folio drivable by weak models:

```
{
  success: boolean
  op: string
  ...payload...                       // tool-specific fields
  notes?: string[]                    // render-blocking issues the engine detected
  next_action?: { tool, params, remaining, hint }   // call THIS next
  handover?: { workflow_step, workflow_next, suggested_next[], carry_forward }
  context?: { artifacts:[{path, role}], ... }        // files created/modified/opened
  open_url? / view_url? / edit_url?   // tokenized editor / report links
  token_estimate: number
}
```

`toMCPResult()` flattens this into the MCP `content[]` envelope and trims it to the
`FOLIO_OUTPUT_BUDGET` token cap (default 1000). The **next_action** and **handover**
protocols let a model chain tools without re-deriving state. See [MCP.md §5](MCP.md).

### 3.4 Path normalization

`normalizeProjectPaths()` runs on every `tools/call` (HTTP) before the handler.
LLMs guess absolute paths badly, so it rewrites `project_path`/`path`/`design_path`
so a design always lands under `FOLIO_PROJECTS_DIR` — the only root the editor can
serve. A bare name (`"rainforest"`) is resolved to the projects dir; a misguessed
absolute path is corrected. The engine's own `resolvePath()` then gates every
read/write to the projects dir or `/tmp`.

---

## 4. DATA FLOWS

### 4.1 Editor flow (browser)

```
.design.yaml  (file open / Monaco edit / MCP mutation via SSE)
      │
      ▼  src/schema/parser.ts            parseDesign(yaml) → DesignSpec
      ▼  src/schema/validator.ts         validate() → ValidationError[]
      ▼  src/editor/state.ts             StateManager.set('design', spec)
      │        ├── ui/panels/*           layer / properties / problems re-render
      │        └── ui/panels/page-strip  carousel thumbnails
      ▼  src/engine/token-resolver.ts    $token → theme value
      ▼  src/engine/shorthand-expander   pos:[x,y,w,h] → {x,y,width,height}
      ▼  src/renderer/renderer.ts        renderDesign(spec) → SVGSVGElement
      │        ├── fill-renderer.ts      solid/linear/radial/conic/noise/pattern/image
      │        ├── effects-renderer.ts   shadow/blur/blend/duotone/grain → <filter>
      │        └── layer-renderers*.ts   per-type → SVGElement (lazy for mermaid/…)
      ▼  render cache (per-layer prop hash)
      ▼  canvas.svgContainer ← SVG
```

### 4.2 MCP generation flow (LLM)

```
tools/call (JSON-RPC over stdio or HTTP)
      │
      ▼  http-server.ts / tierN server   route → dispatch
      ▼  normalizeProjectPaths(args)     fix LLM path guesses
      ▼  ALL_HANDLERS[name](args)        e.g. addLayers / appendPage
      │        └── shorthand-parser      expandShorthand(layer) → full Layer
      ▼  engine/utils.snapshot()         write .mcp_versions/ backup first
      ▼  writeYAML()                     js-yaml.dump → fs.writeFileSync
      ▼  result.next_action / open_url   returned to the model
      │
      └── (HTTP) editorBroadcast('file_changed', path)  → /editor/events SSE
                 → any open editor reloads the design instantly
```

### 4.3 Export flow

```
Browser export (toolbar):  src/export/exporter.ts
   exportToSVG()   XMLSerializer
   exportToPNG()   SVG → Image → Canvas → PNG (×1/×2/×3)
   exportToPDF()   PNG per page → jsPDF (lazy)
   exportToHTML()  SVG + design JSON + animation CSS → self-contained .html

Server-side export (MCP export_design):  src/mcp/engine/svg-export.ts
   jsdom document → renderer.ts renderDesign() → serialize → .svg file
   (no browser; runs under Bun/Node in the container)

Report / presentation export:  src/export/*-assembler.ts
   design + datasets + runtime → one self-contained .html
```

---

## 5. RENDER PIPELINE (`src/renderer/`)

| File | Responsibility |
|---|---|
| `renderer.ts` | Pipeline: shorthand expand → token resolve → z-sort → per-layer dispatch → dirty-tracking cache. `renderDesign` (poster) + `renderPage` (carousel). |
| `layer-renderers.ts` (facade) | One renderer per layer type, split across `-shared / -shapes / -embed / -layout`. Lazy `import()` for mermaid/vega/katex/prism. |
| `fill-renderer.ts` | `applyFill()` — solid · linear · radial · conic (approx) · noise (feTurbulence) · pattern · image (tile/cover/contain). |
| `effects-renderer.ts` | `applyEffects()` → SVG `<filter>` in `<defs>`: drop shadow (with spread), blur, opacity, mix-blend-mode, duotone, grain, posterize. |
| `svg-utils.ts` | `createSVGElement`, `createSVGRoot`, `getOrCreateDefs`, `uniqueDefId` (counter reset per pass). |
| `lucide-icons.ts` | 80+ Lucide icon path data, resolved by name. |
| `qr/` | Dependency-free QR encoder. |

**Dirty tracking:** a `Map<layerId, {hash, svg}>` keyed by `JSON.stringify(layer)`.
On a single-layer change only that layer re-renders (cache-clone the rest). The cache
fully clears on theme change, zoom, or canvas resize.

**Determinism invariant:** the same YAML must produce identical SVG on repeated calls
— no `Math.random()` / `Date.now()` in the render path (seed by layer id instead).

**Layer types (35):** `rect circle ellipse path polygon polyline line text image icon
component component_list mermaid chart code math group qrcode auto_layout
interactive_chart interactive_table rich_text kpi_card map embed_code popup particle
button tabs accordion filter_bar toggle tooltip callout progress`. The `interactive_*`,
`rich_text`, `kpi_card`, and the component group (`button/tabs/accordion/filter_bar/
toggle/tooltip/callout/progress`) power flow-layout reports — see [REPORT_ENGINE.md](REPORT_ENGINE.md).

---

## 6. SCHEMA & ENGINE CORE

### 6.1 `src/schema/`

| File | Responsibility |
|---|---|
| `types.ts` (barrel) | Re-exports `types/primitives.ts` (Fill, Stroke, Effects, color/units), `types/layers.ts` (LayerType union + every concrete layer), `types/document.ts` (DesignSpec, ThemeSpec, ComponentSpec, TemplateSpec, ProjectSpec, report types). |
| `parser.ts` | YAML ↔ DesignSpec. `ParseError` carries line/column. |
| `validator.ts` | Required fields, duplicate IDs, z-index collisions, fill validation → `ValidationError[]` with severity + dot-path. |

### 6.2 `src/engine/`

| File | Responsibility |
|---|---|
| `token-resolver.ts` | `$token` → theme value. Lookup: overrides → colors → typography → effects → radii → deep search. Fallback `#FF00FF`. Recursive over fills/strokes/text/shadows. |
| `shorthand-expander.ts` | `pos:[x,y,w,h]` → explicit `{x,y,width,height}`. (Engine-side position shorthand; the richer MCP shorthand lives in `mcp/shorthand-parser.ts`.) |
| `component-resolver.ts` | `{{propName}}` slot substitution; validates required props; inlines `.component.yaml` at render time. |

### 6.3 Theme tokens

Any color/font value prefixed with `$` resolves against the active theme at render
time: `$primary`, `$surface`, `$text_muted`, `$heading` (→ `typography.families.heading`).
**17 built-in themes** ship in `src/themes/builtin.ts`: `dark-tech light-clean ocean-blue
neon-bloom indigo-pro sunset-glow mono-print forest-deep pastel-dream high-contrast
brutalist-mono cyber-synthwave editorial-cream corporate-slate bold-poster
swiss-international gallery`. Custom themes live in a project's `themes/` and are
registered in `project.yaml`.

### 6.4 Z-index bands

```
0–9    Background   full-bleed fills, textures, decor
10–19  Structural   cards, frames, containers, rules
20–49  Content      text, icons, images, charts
50–69  Overlay      color washes, decorative overlays
70–89  Foreground   accent shapes, highlights
90–99  UI           editor-only handles (never written to files)
```

---

## 7. EDITOR & UI (`src/editor/`, `src/ui/`)

| File | Responsibility |
|---|---|
| `editor/state.ts` | Reactive single source of truth (design, theme, selection, zoom/pan, mode, page index, grid, undo stack ≤100). Observer pattern; `batch()` coalesces. |
| `editor/app.ts` (+`app-base`) | Bootstrap: builds layout, instantiates managers, loads theme + sample design, wires the file watcher / SSE. |
| `editor/canvas.ts` (+`-base/-interactions/-draw`) | SVG container, selection overlay, pointer drag/rotate, wheel zoom/pan, smart guides, rulers. |
| `editor/interactions.ts` | interact.js draggable (snap to grid/edges) + resizable (8 handles). |
| `editor/keyboard.ts` | All shortcuts (undo/redo, tools, clipboard-as-YAML, group, z-order). |
| `editor/payload-editor.ts` | Monaco (lazy). Two-way sync, 300ms debounce, validation markers, re-entrancy guards. |
| `editor/static-server.ts` | **Bun static file server** for the built editor in Docker. Serves `dist/`, mounts `FOLIO_PROJECTS_DIR` at `/__project_files/*`, validates a Bearer/`?token=`/`folio_session` cookie (JWT-aware), sets the session cookie. *(Replaces the old `vite preview`.)* |

`src/ui/` holds the panels (layer, properties, problems, file-tree, page-strip,
timeline), dialogs (catalog), the command palette, and toolbars (align, toolbox).
Full editor guide: [EDITOR.md](EDITOR.md).

---

## 8. TRANSPORTS, ENDPOINTS & AUTH

Two long-lived servers run in the `both` container role (default):

| Server | File | Port (in-container) | Role |
|---|---|---|---|
| MCP HTTP | `mcp/http-server.ts` | `FOLIO_PORT` = 3333 | JSON-RPC, SSE, OAuth, health |
| Editor static | `editor/static-server.ts` | `PORT` = 4173 | Built editor + project-file fetch |

### 8.1 HTTP endpoints (MCP server, :3333)

| Method · path | Auth | Purpose |
|---|---|---|
| `GET  /health` | none | Liveness: `{status, version, tiers, auth}` |
| `POST /mcp` | Bearer | JSON-RPC: `initialize` · `tools/list` · `tools/call` |
| `GET  /mcp/sse` | Bearer | SSE stream of every tool response |
| `GET  /editor/events` | Bearer or `?token=` | File-change SSE for live editor refresh |
| `GET  /tokens/whoami` | Bearer | Returns the named token that authenticated |
| `GET  /.well-known/oauth-authorization-server` | none | RFC 8414 metadata |
| `GET  /.well-known/oauth-protected-resource` | none | RFC 9728 metadata |
| `GET/POST /oauth/authorize` | none | Login form → auth code (PKCE) |
| `POST /oauth/token` | none | code → access+refresh token |
| `POST /oauth/register` | none | RFC 7591 dynamic client registration |

### 8.2 Auth resolution (`mcp/auth.ts`, `mcp/jwt.ts`, `mcp/oauth.ts`)

First strategy that resolves wins:

```
FOLIO_TOKENS_FILE  (tokens.json: { "name": "sk-..." })   ← production, named/audited
FOLIO_TOKENS       ("name:sk-...,other:sk-...")           ← env-only multi-token
FOLIO_API_KEY      (single shared bearer)                 ← legacy
(none)             → open mode                            ← localhost / private net
```

On top of that:
- **JWT (HS256, `jwt.ts`)** — `FOLIO_JWT_SECRET` (falls back to `FOLIO_API_KEY`) signs
  stateless 30-day editor-link tokens that `open_in_editor`/`create_design` return.
  The raw secret also works as a master bearer. Survives restarts; no server store.
- **OAuth 2.0 + PKCE (`oauth.ts`)** — the claude.ai Custom Connector flow. The
  access token issued by `/oauth/token` bridges to whichever Folio API key the user
  typed at `/oauth/authorize`. Access (24h) and refresh (30d, rotating) tokens are
  persisted to `FOLIO_OAUTH_STATE_DIR` so a container bounce never forces re-auth.

Every authenticated `tools/call` writes one audit line to stderr:
`[mcp] token=<name> tool=<tool> ok=<bool>` — token *values* are never logged.

Full deploy + endpoint + auth reference: [DEPLOYMENT.md](DEPLOYMENT.md).
Per-client setup: [INTEGRATIONS.md](INTEGRATIONS.md).

### 8.3 Memory safety

The container is memory-capped (default `mem_limit: 1g`). Guards: `/mcp` body capped
at `FOLIO_MAX_BODY_BYTES` (32 MiB), OAuth bodies at 256 KiB, `editorBroadcast` skips
files over `FOLIO_MAX_BROADCAST_BYTES` (16 MiB), dead SSE clients are pruned on write,
and both servers run under `bun --smol`.

---

## 9. BUILD, TEST & DEPLOY PIPELINE

### 9.1 Commands

```bash
npm run dev          # Vite dev server + HMR → http://localhost:5173
npm run gen          # regenerate catalog/palette/type-pack/effects/font indexes
npm run build        # gen + tsc + vite build → dist/
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint src --max-warnings 0  (incl. max-lines:700)
npm run test:unit    # vitest run
npm run test:integration
npm run test:e2e     # playwright (chromium)
npm run test:visual  # playwright visual regression
FOLIO_MCP_TIER=all bun run src/mcp/index.ts   # stdio MCP, full surface
bun run src/mcp/http-server.ts                # HTTP MCP on :3333
```

> The host this repo is developed on is RAM-tight; `npm run build` (vite) can OOM
> locally — it's a CI/runner step. `tsc`, `eslint`, and `vitest` run fine locally.

### 9.2 Runtime model — runs from source

The Docker image is `oven/bun` and runs the TypeScript **directly from `src/`** via
Bun (no compiled `dist/` for the MCP server; the editor is the only built artifact).
That makes deploy of a code change a source sync + restart, not a rebuild:

```bash
docker cp src/. folio:/app/src && docker restart folio
```

Because facades re-export their siblings, copy the **whole tree** (a partial copy
breaks the import graph). Verify with `curl localhost:3333/health`.

### 9.3 Test architecture

```
Vitest      unit + integration (jsdom env), co-located *.test.ts
Playwright  e2e (real Chromium) + visual regression (≤1% pixel diff)
```

Coverage targets: token-resolver 98% · schema 95% · renderer 90% · MCP 90% ·
export 85% · overall >80%. Key invariants: render determinism, token precedence,
undo/redo exactness, self-contained HTML export (no external URLs), and MCP
round-trip (`create → append → seal` → valid `.design.yaml`).

---

## 10. EXTENDING FOLIO

### 10.1 Add an MCP tool

1. Implement the handler in the right `engine-*-tools.ts` (pure function:
   `(args) => ToolResult`). Snapshot before any write via `engine/utils.snapshot()`.
2. Re-export it from the `engine.ts` facade if needed.
3. Register the JSON schema in the matching `tierN/registry.ts` (`TIERn_TOOLS`).
4. Add it to the tier's handler map so it lands in `ALL_HANDLERS`.
5. If it mutates a `.design.yaml`, add the tool name to `FILE_MUTATING_TOOLS` in
   `http-server.ts` so the editor live-refreshes.
6. Write a co-located `*.test.ts`. Keep every file ≤700 lines.

> Reconnect caveat: an MCP client caches `tools/list` at connect time. After adding a
> tool, reconnect the client (or restart it) to see it.

### 10.2 Add a layer type

1. Add the literal to the `LayerType` union and a concrete interface in
   `schema/types/layers.ts`.
2. Add a renderer in the appropriate `layer-renderers-*.ts` and dispatch it from
   `renderer.ts`.
3. Add shorthand expansion in `shorthand-parser` if it needs compact authoring.
4. Add validation rules in `validator.ts`. Add tests.

### 10.3 Add a theme

Append to `src/themes/builtin.ts` (full color palette + typography + spacing +
effects + radii), or drop a `.theme.yaml` in a project's `themes/` and register it
in `project.yaml` via `themes` (op:apply).

---

## 11. SEE ALSO

| Doc | Covers |
|---|---|
| [MCP.md](MCP.md) | MCP standard, transports, tiers, wire protocol, workflows, shorthand |
| [TOOLS.md](TOOLS.md) | Every one of the 21 tools — params, returns, examples |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker, Caddy/TLS, endpoints, env vars, auth, backups |
| [INTEGRATIONS.md](INTEGRATIONS.md) | claude.ai, Claude Code, LM Studio, Hermes/OpenClaw, editor wiring |
| [EDITOR.md](EDITOR.md) | Visual editor: canvas, panels, shortcuts, export, live refresh |
| [DESIGN.md](DESIGN.md) | Design system + full `.design.yaml` payload spec |
| [REPORT_ENGINE.md](REPORT_ENGINE.md) | Interactive flow-layout reports + components |
