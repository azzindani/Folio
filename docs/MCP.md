# MCP.md — Folio as an MCP Engine

> How Folio exposes design generation over the **Model Context Protocol (MCP)**.
> This is the document for anyone driving Folio from an LLM — claude.ai, Claude
> Code, LM Studio, or any custom harness. For per-tool detail see [TOOLS.md](TOOLS.md);
> for hosting see [DEPLOYMENT.md](DEPLOYMENT.md); for client setup see
> [INTEGRATIONS.md](INTEGRATIONS.md).

---

## 1. WHAT THIS GIVES AN LLM

Folio is an MCP **server**. Any MCP-capable client (the *host*) can list its tools
and call them. The tools let a model:

- scaffold a project, create a poster/carousel/report/presentation design,
- compose layers in a compact **shorthand** (≈80% fewer tokens than verbose YAML),
- inspect, diagnose, patch, and seal a design,
- export to SVG / self-contained HTML / PDF / animation,
- and get back a **live editor link** so a human can see the result.

Because it speaks the MCP standard over both stdio and HTTP, *no client-specific
code is required* — if the client can talk MCP, it can drive Folio.

```
┌─────────────┐   MCP (JSON-RPC 2.0)   ┌──────────────────────────┐
│   HOST/LLM  │  ───────────────────▶  │   Folio MCP server        │
│ claude.ai   │   tools/list           │   50 tools, 3 tiers       │
│ Claude Code │   tools/call           │   stdio  OR  HTTP+SSE     │
│ LM Studio   │  ◀───────────────────  │   reads/writes .yaml      │
│ any harness │   ToolResult + next     │   server-side SVG export  │
└─────────────┘                        └──────────────────────────┘
```

---

## 2. TRANSPORTS

Folio implements the same tool surface over two transports. Pick by where the model
runs.

### 2.1 stdio (local)

The classic MCP transport: the host launches Folio as a subprocess and exchanges
newline-delimited JSON-RPC over stdin/stdout.

- Entry point: `src/mcp/index.ts`
- Run: `bun run src/mcp/index.ts` (Bun is recommended — native TS, ~50 ms cold start;
  Node + `ts-node/esm` is the fallback).
- Tier is chosen by `FOLIO_MCP_TIER` (`1` | `2` | `3` | `all`).
- Best for: a model running on the same machine (LM Studio, local Claude Code).
- Auth: none — it's a process-local pipe.

```jsonc
// host mcp.json entry
{ "command": "bun",
  "args": ["run", "/abs/path/Folio/src/mcp/index.ts"],
  "env": { "FOLIO_MCP_TIER": "all" } }
```

### 2.2 HTTP + SSE (hosted / remote)

A long-lived HTTP server exposing JSON-RPC at `POST /mcp`, with optional SSE streams.

- Entry point: `src/mcp/http-server.ts` (`bun run src/mcp/http-server.ts`).
- Port: `FOLIO_PORT` (default `3333`).
- Always serves the **full 50-tool union** (tiers are a stdio-only concept).
- Auth: Bearer token (or OAuth — see [DEPLOYMENT.md](DEPLOYMENT.md)).
- Best for: claude.ai Custom Connectors, remote Claude Code, Hermes, OpenClaw, any
  MCP-over-HTTP agent, and the Docker deployment.

```
POST /mcp            JSON-RPC: initialize · tools/list · tools/call
GET  /mcp/sse        SSE stream of every tool response
GET  /editor/events  SSE file-change stream (drives live editor refresh)
GET  /health         liveness (no auth)
GET  /tokens/whoami  which named token authenticated this request
```

Both transports dispatch through the same `ALL_HANDLERS` map, so behaviour is
identical — only framing and auth differ.

---

## 3. TIERS (stdio only)

Tools are grouped so a small-context model can register only what it can use. Over
HTTP all 50 are always present; over stdio you choose.

| Tier | `FOLIO_MCP_TIER` | Count | What it adds |
|---|---|---|---|
| Basic | `1` | 15 | projects, lists, tasks, library browse, themes, rename/move/delete, enrich_brief |
| Design | `2` | 10 | create_design, add_layers, inspect, patch, seal, extract_reference |
| Export | `3` | 24 | export_design, templates, components, reports, presentations, animation, formula, collab, diagnose, render_preview |

Tiers are **exclusive** — register tier 1, 2, and 3 as three separate servers to get
the union without duplicate tool names, or register `all` for the whole surface in a
single server. Sizing guidance:

```
Gemma 4B  128K ctx → tier all is fine; 5–8 layers/page
Qwen 9B    64K ctx → tier 1+2; load guide sections on demand
Qwen 2B    32K ctx → tier 1 only; shorthand section only; 3–4 layers/page
```

---

## 4. WIRE PROTOCOL

Standard MCP JSON-RPC 2.0. No Folio-specific extensions on `initialize` / `tools/list`
/ `tools/call`.

### 4.1 Handshake

```jsonc
→ {"jsonrpc":"2.0","id":1,"method":"initialize"}
← {"jsonrpc":"2.0","id":1,"result":{
     "protocolVersion":"2024-11-05",
     "capabilities":{"tools":{}},
     "serverInfo":{"name":"folio-mcp-http","version":"1.0.0"}}}
→ {"jsonrpc":"2.0","method":"notifications/initialized"}
```

### 4.2 Listing tools

```jsonc
→ {"jsonrpc":"2.0","id":2,"method":"tools/list"}
← {"jsonrpc":"2.0","id":2,"result":{"tools":[ /* 50 ToolDefinition objects */ ]}}
```

### 4.3 Calling a tool

```jsonc
→ {"jsonrpc":"2.0","id":3,"method":"tools/call",
   "params":{"name":"create_design",
             "arguments":{"project_path":"launch","name":"cover","type":"poster"}}}
← {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"…JSON…"}]}}
```

The `text` payload is the `ToolResult` (§5) serialized and trimmed to the output
budget. Errors inside a tool come back as a normal result with `success:false` and a
`hint`; only malformed JSON-RPC yields a protocol-level `error` object.

### 4.4 curl smoke test (HTTP)

```bash
BASE=https://folio.example.com ; TOK=sk-folio-...
curl -s $BASE/health | jq .                       # {"status":"ok",...}
curl -s $BASE/tokens/whoami -H "Authorization: Bearer $TOK" | jq .
curl -s $BASE/mcp -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools|length'   # 50
```

---

## 5. THE HANDOVER PROTOCOL (why weak models can drive Folio)

Every Folio tool returns more than a result — it returns *the next step*. This is
what lets a small local model complete a multi-tool workflow without losing the plot.

### 5.1 `next_action`

Every **write** tool returns:

```jsonc
"next_action": { "tool": "seal_design", "params": { "design_path": "…" },
                 "remaining": 0, "hint": "Design composed — seal to freeze." }
```

Rule for the model: **call `next_action.tool` as your very next tool call.**
`remaining > 0` means more pages/steps; `remaining == 0` means the sequence is done
(usually `seal_design` or `export_design`).

### 5.2 `handover`

Every response also includes:

```jsonc
"handover": {
  "workflow_step": "COMPOSE",                 // PROJECT→DESIGN→COMPOSE→SEAL→EXPORT
  "workflow_next": "SEAL",
  "suggested_next": [ {tool, params, why}, … ],   // 3 concrete options
  "carry_forward": { "design_path": "…" }     // params to reuse next call
}
```

### 5.3 `notes` — the engine reviews its own output

`add_layers` (and friends) return `notes:[…]` flagging things a vision-blind model
can't see: invisible text (low contrast / text wider than its chip), off-canvas
layers, missing background, `text_overflow`, weak hierarchy, accent sprawl, off-grid
edges. **Read the notes and fix the weakest thing in your next call.** A strong poster
is usually 2–3 refinement rounds, not one shot.

### 5.4 `open_url` / `view_url` / `edit_url`

`create_design` / `append_page` / `seal_design` / `export_design` return an
`open_url` — a tokenized, ready-to-click editor link (no separate `open_in_editor`
call needed). `export_report` returns `view_url` (the **final** interactive HTML — give
the user *that*) and `edit_url`. The token is a stateless 30-day JWT when a JWT secret
is configured. See [EDITOR.md](EDITOR.md).

### 5.5 Context recovery

After any context reset the model can recover exact state:

```
resume_task(task_path)   → exact next tool + params for a carousel
resume_design(path)      → carousel page-generation progress
list_tasks(project_path) → find a lost task_path
```

---

## 6. SHORTHAND — the compact authoring syntax

Designs on disk are verbose YAML (2000–4000 tokens). Models author in **shorthand**
via the `layers_shorthand` field, which `shorthand-parser.ts` expands to full layers
before writing. This is ~80% cheaper on tokens.

```jsonc
// pos:[x,y,w,h] replaces x/y/width/height
{id:"bg",   type:"rect", z:0,  pos:[0,0,1080,1350], fill:"#FAF5EC"}
{id:"head", type:"text", z:10, pos:[96,250,880,470], text:"Headline.",
            size:108, weight:800, color:"#2A2218", font:"Playfair Display", lh:1.02}
{id:"ico",  type:"icon", z:9,  pos:[880,80,64,64], icon:"star", color:"#E94560"}
```

### 6.1 Auto-layout (don't hand-compute child coordinates)

Give the **container** a `pos`; give each **child** only `width`+`height`:

```jsonc
{id:"row", type:"row", pos:[60,500,960,360], gap:30, justify:"space-between", layers:[
  {type:"column", width:300, height:360, gap:12, padding:24, fill:"#16213E", radius:16, layers:[
    {type:"icon", width:48, height:48, icon:"zap", color:"#E94560"},
    {type:"text", width:252, height:40, text:"Fast", size:32, weight:700} ]} ]}
```

`row` / `column` / `grid` flow children automatically (`gap`, `padding`, `align`,
`justify`, `wrap`). `repeat:N` or `repeat:[{…},{…}]` stamps one template × N with
`{{i}}` / `{{key}}` token fill.

### 6.2 Presets (the engine owns the layout)

For the common poster shapes, hand-placement collides — use a **preset** (one layer;
the engine measures and positions everything):

| Preset (aliases) | Use for |
|---|---|
| `editorial` (poster) | text-forward poster: kicker · rule · headline · deck · body · footer |
| `feature_grid` | feature/benefit cards |
| `list` (steps, checklist) | "N tips/steps/reasons" numbered/bulleted list |
| `stat` (metric, big_number) | one dominant statistic |
| `event` (flyer, hero) | event/launch flyer (big title + details) |
| `sections` (infographic, document) | rich multi-section report/infographic (tall canvas) |
| `split` | two-panel editorial (color/pattern block + text) |
| `decor` (marble_bg, backdrop) | a designed background in one layer |

Plus `bg_style` (a "+"-combined grammar: `gradient + curve + dots`, `mesh + glow +
grain`, …) composes a collision-proof layered background behind the content. The full
preset/field grammar is in the engine guide — see §7.

### 6.3 Parametric shapes, fills, effects, type

Shapes: `star burst blob wave arc ring bubble heart lightning shield gear arrow
cross_shape`. Fills: solid hex, `rgba()`, linear/radial/conic gradients, **patterns**
(`dots grid halftone blueprint carbon waves chevron …`), and image/texture fills.
Effects: `duotone`, `grain`, `posterize`, `saturate`, `blend_mode`, `backdrop_blur`.
Type effects: `uppercase`, `italic`, `outline`, `highlight`, variable-font `variation`,
OpenType `features`, text-on-`curve`.

---

## 7. THE ENGINE GUIDE (`get_engine_guide`)

The first tool a model should know about. It returns the design rules and recipes in
~200-token sections so the model designs like a human, not an AI template:

```
get_engine_guide(section="quick_ref")   ← canvas sizes, workflows, the anti-AI-look
                                            rules, the editorial recipe, preset index
get_engine_guide(section="shorthand")    ← full shorthand + preset + bg_style grammar
get_engine_guide(section="layers")       ← per-type required fields
get_engine_guide(section="workflow")     ← next_action/handover, patch, report, budgets
get_engine_guide(section="reference")    ← reference-image → design loop
```

Load it once per session (or per section on demand for tiny-context models). The
quick_ref headline guidance, in short: flat solid canvas (no default gradient), type
*is* the design (headline 4–5× the body, pair fonts per layer), one accent used 1–2×,
asymmetry + whitespace, depth via a thin rule not glows, `radius:0` or `999` (avoid the
templated 8–16 middle), and **work in passes** — compose, read the notes + render,
patch the weakest thing, repeat.

---

## 8. CANONICAL WORKFLOWS

### 8.1 Poster (single page)

```
0. enrich_brief        (if the prompt is short/vague — returns preset + content outline)
1. create_project      (bare name, e.g. "ai-poster")
2. create_design       (type:"poster")               → next_action: add_layers
3. add_layers          (layers_shorthand=[…])         → read notes; next_action: seal
4. diagnose_design     (fix every error, re-run to zero)        [recommended]
5. render_preview      (PNG, so you can SEE it)                  [recommended]
6. seal_design                                        → returns open_url
7. export_design       (format:"svg")                            [optional]
```

### 8.2 Carousel (multi-page, incremental)

```
1. create_task   (pages=[{label,hints}])  → first append_page baton
2. append_page   (per page; pass task_path) → repeat until remaining==0
3. seal_design
```

### 8.3 Interactive report (flow layout)

```
1. generate_report  (layout:"flow", pages, data_sources)
2. bind_data        (inline/json/csv/query/transform datasets)
3. add_layers       (flow widgets, each with a span 1–12)
4. validate_report  (lint data_refs/fields/actions — fix errors)
5. export_report    (theme) → view_url (the deliverable) + edit_url
```

See [REPORT_ENGINE.md](REPORT_ENGINE.md).

### 8.4 Presentation (animated deck)

```
1. create_presentation  (1920×1080, slides, 17 transitions, auto-advance)
2. append_page          (per slide)
3. set_formula_context / add_keyframe   (optional)
4. export_presentation  → self-contained HTML presenter (keyboard/touch/teleprompter)
```

### 8.5 Patch a sealed design

```
1. patch_design (selectors, dry_run:true)   ← validate selectors
2. patch_design (selectors)                  ← apply
3. seal_design
```

---

## 9. OUTPUT BUDGET & CONSTRAINED MODE

- `FOLIO_OUTPUT_BUDGET` (default `1000`) caps each tool response in tokens. When a
  response exceeds it, least-critical fields trim first (artifact paths → extra
  suggested tools → extra progress items → backup full path). Lower it for tiny models.
- `MCP_CONSTRAINED_MODE=true` halves list/layer/search row limits for low-RAM machines.

---

## 10. PATHS — the #1 LLM failure

Pass `project_path` / `path` as a **short bare name** (`"ai-poster"`). The engine
places it under `FOLIO_PROJECTS_DIR` automatically, and `normalizeProjectPaths()`
corrects misguesses. **Never** build absolute paths like `/home/...` — you can't know
the container layout, and a wrong guess opens the editor on an empty canvas. The
canonical project root inside Docker is `/home/folio/projects`; on the host that's the
bind-mounted `./folio-projects`.

---

## 11. SEE ALSO

- [TOOLS.md](TOOLS.md) — every tool, its params and a call example
- [INTEGRATIONS.md](INTEGRATIONS.md) — connect claude.ai / Claude Code / LM Studio / harnesses
- [DEPLOYMENT.md](DEPLOYMENT.md) — host it, secure it, expose the endpoints
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the MCP layer is built internally
- [DESIGN.md](DESIGN.md) — the full `.design.yaml` payload spec
