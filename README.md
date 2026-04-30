# Folio

A self-hosted MCP server and browser-based graphic design editor that gives local LLMs structured tools to generate, edit, and export designs as plain YAML files. No cloud APIs, no subscriptions — everything runs on your machine.

## Features

- **41 MCP tools** across 3 servers: basic (10), design (9), export (22)
- **CREATE → COMPOSE → SEAL → EXPORT** workflow for structured design generation
- **Automatic snapshots** — every write creates a `.mcp_versions/` backup before touching disk
- **Operation receipt logging** — full audit trail at `~/.folio/ops.log`
- **Constrained output mode** — caps tool responses at 1,000 tokens for local models (configurable)
- **Handover protocol** — every response includes the next 3 suggested tool calls with pre-filled params so LLMs can chain tools without losing state
- **Context recovery** — `resume_task` and `resume_design` restore full carousel state after context resets
- **Shorthand layer syntax** — `pos:[x,y,w,h]`, `fill:"#hex"`, `icon:"star"` — ~80% fewer tokens than verbose YAML
- **14 layer types** — rect, circle, text, line, path, icon, image, group, mermaid, chart, code, math, component, particle
- **Live SVG export** — server-side jsdom renderer writes real `.svg` files from MCP without a browser
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
- **Remote clicker** — `setup_remote_presenter` MCP tool generates SSE server + client JS for HTTP-controlled slide navigation
- **Collaborative editing** — `setup_collab` MCP tool generates SSE file-watch server; multi-user design sync via `/patch` + `/events` endpoints
- **Modular architecture** — thin MCP wrappers, zero domain logic in servers; all business logic in `engine.ts`

---

## Visual Editor

Folio ships a full browser-based design editor accessible at `http://localhost:5173` after `npm run dev`. It operates on the same `.design.yaml` files the MCP server reads and writes — no conversion step.

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

The engine is the layer between the YAML file and the rendered SVG. It runs in both the browser (for the visual editor) and Node/Bun (for MCP export). Every design is a `.design.yaml` file — the canvas is a live view, never the source of truth.

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
## Important: Always Use Absolute File Paths

> **Do not use relative paths with `project_path` or `design_path`.**
>
> The MCP server runs as a subprocess and resolves paths from its own working directory, not yours. Relative paths will silently point to the wrong location.
>
> Always give the model the full absolute path:
> ```
> Create a design in C:\Users\you\designs\my-project
> ```
> The model passes that path directly to the MCP tools. `~` expansion is not supported in all clients.

---

## Quick Install (LM Studio)

### Requirements

- **Git** — `git --version`
- **Bun 1.0+** — `bun --version` ([install guide](https://bun.sh/docs/installation))
- **LM Studio** with a model that supports tool calling (Gemma 4B, Qwen 3.5, etc.)

### Platform Support

| Platform | Status |
|---|---|
| Windows | Untested — CI/CD pipeline passes |
| macOS | Untested — CI/CD pipeline passes |
| Linux | Tested — real-world verified |

### First Run

The first launch clones the repo and installs dependencies (~1–2 minutes). Subsequent launches are instant.

> **Pre-install recommended (Windows):** To avoid the LM Studio connection timeout on first launch, run this once in PowerShell before connecting:
> ```powershell
> $d = Join-Path $env:USERPROFILE '.mcp_servers\Folio'
> git clone https://github.com/azzindani/Folio.git $d --quiet
> Set-Location $d; bun install --frozen-lockfile
> ```
> If you skip this and LM Studio times out, press **Restart** in the MCP Servers panel — it will reconnect and complete the install.

---

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
5. Start chatting — the model will see all 25 tools

> For small models (≤32K context), use only `folio_basic` (10 tools). For 64K+ models, add `folio_design`. For 128K models, all three.

---

### macOS / Linux (bash)

Replace the entries above with the bash equivalent:

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

## Available Tools

### Tier 1 — Basic (10 tools)

Project management, navigation, and task planning. Safe to use with any model — no file writes, minimal token cost.

| Tool | Purpose |
|---|---|
| `get_engine_guide` | Load engine reference guide by section: `quick_ref`, `shorthand`, `layers`, `workflow` (~200 tokens each) |
| `create_project` | Scaffold project directory with `designs/`, `assets/`, `themes/`, `exports/` and `project.yaml` |
| `list_designs` | List all `.design.yaml` files in a project with status and page count |
| `list_tasks` | List task files with progress status (pages done / total) |
| `list_themes` | List available themes registered in `project.yaml` |
| `apply_theme` | Set active theme for a project — updates `project.yaml` |
| `duplicate_design` | Copy a design with a new name and fresh UUID — registers in `project.yaml` |
| `create_task` | Plan a multi-page carousel — scaffolds task file and first design, returns first `append_page` baton |
| `resume_task` | Read task state and return exact next tool call — use after any context reset |
| `resume_design` | Read carousel generation state to continue appending pages |

---

### Tier 2 — Design (9 tools)

Full design lifecycle — create, inspect, build, edit. All write tools create a `.mcp_versions/` snapshot before touching disk.

| Tool | Purpose |
|---|---|
| `create_design` | Create a new blank `.design.yaml` (poster or carousel) registered in `project.yaml` |
| `inspect_design` | Return design metadata, layer summary, page list, and validation errors |
| `add_layers` | Add one or more layers using shorthand syntax — 80% fewer tokens than verbose YAML |
| `append_page` | Add a page to a carousel design; returns next `append_page` baton or `seal_design` when done |
| `add_layer` | Add a single layer by ID — surgical insert without replacing others |
| `update_layer` | Update specific fields on an existing layer by ID |
| `remove_layer` | Remove a layer by ID |
| `patch_design` | Apply JSON-pointer selectors to any field; supports `dry_run: true` to validate before writing |
| `seal_design` | Mark design complete, validate all layers, freeze `_mode: complete` |

---

### Tier 3 — Export (22 tools)

SVG/HTML export, batch generation, templates, component extraction, report assembly, presentations, formula binding, animation, and collaboration.

| Tool | Purpose |
|---|---|
| `export_design` | Export to SVG (server-side jsdom renderer) or self-contained HTML; PDF stages HTML for Puppeteer |
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
Create a project at C:\Users\me\designs\work, then make a dark tech poster with a bold headline and a red pill badge
```

### Build a carousel

```
Plan a 5-slide product launch carousel at C:\Users\me\designs\launch — cover, problem, solution, features, CTA
```

### Resume after context reset

```
Resume the task at C:\Users\me\designs\launch\tasks\product-launch.task.yaml
```

### Export as SVG

```
Export C:\Users\me\designs\work\designs\poster.design.yaml as SVG
```

### Batch from template

```
Generate 10 variations of the announcement template using the slots in C:\Users\me\designs\templates\announcement.template.yaml
```

### Patch a specific field

```
Change the headline text in C:\Users\me\designs\work\designs\poster.design.yaml to "Q3 Results"
```

### Open the visual editor

```bash
npm run dev   # → http://localhost:5173
```

---

## Configuration

### Token Budget

Set `FOLIO_OUTPUT_BUDGET` in the `env` section of `mcp.json` to cap tool response size in tokens. Default is `1000`. When a response exceeds the budget, least-critical fields are trimmed first (artifact paths → extra suggested tools → extra progress items → backup full path).

### Constrained Mode

Set `MCP_CONSTRAINED_MODE=true` to reduce result set sizes for lower-memory machines. This halves list row limits, layer row limits, and search result counts.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FOLIO_OUTPUT_BUDGET` | `1000` | Max tokens per tool response |
| `FOLIO_MCP_TIER` | `1` | Tool tier: `1` basic, `2` basic+design, `3` all |
| `MCP_CONSTRAINED_MODE` | `false` | Set `true` to reduce result sizes for low-RAM machines |

---

## Uninstall

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

---

## Architecture

```
Folio/
├── src/
│   ├── mcp/
│   │   ├── index.ts             ← entry point; selects tier via FOLIO_MCP_TIER
│   │   ├── engine.ts            ← all 25 tool implementations (zero MCP imports)
│   │   ├── types.ts             ← ToolResult, ProgressItem, Handover, ContextField
│   │   ├── shorthand-parser.ts  ← expands layers_shorthand → full Layer objects
│   │   ├── engine/
│   │   │   ├── utils.ts         ← resolvePath, snapshot, readYAML, writeYAML, okResult, errResult
│   │   │   ├── guide.ts         ← 4-section engine reference guide (~200 tokens/section)
│   │   │   ├── svg-export.ts    ← server-side SVG renderer (jsdom + renderer.ts)
│   │   │   ├── task.ts          ← carousel task file CRUD + next-action baton
│   │   │   └── coerce.ts        ← input coercion helpers
│   │   ├── tier1/
│   │   │   ├── server.ts        ← thin MCP stdio wrapper for Basic tools
│   │   │   └── registry.ts      ← tool definitions (name, description, inputSchema)
│   │   ├── tier2/
│   │   │   ├── server.ts        ← thin MCP stdio wrapper for Design tools
│   │   │   └── registry.ts
│   │   └── tier3/
│   │       ├── server.ts        ← thin MCP stdio wrapper for Export tools
│   │       └── registry.ts
│   ├── renderer/
│   │   ├── renderer.ts          ← renderDesign() / renderPage() → SVGSVGElement
│   │   ├── layer-renderers.ts   ← per-type renderers (rect, text, image, icon, …)
│   │   ├── fill-renderer.ts     ← solid, linear, radial, conic, noise gradient fills
│   │   ├── effects-renderer.ts  ← drop shadow (with spread), blur, blend mode
│   │   ├── svg-utils.ts         ← createSVGElement, getOrCreateDefs, uniqueDefId
│   │   ├── lucide-icons.ts      ← 80+ Lucide icon SVG paths
│   │   └── qr/                  ← QR code encoder (no external deps)
│   ├── schema/
│   │   ├── types.ts             ← all TypeScript interfaces (Layer, DesignSpec, ThemeSpec, …)
│   │   ├── parser.ts            ← YAML → DesignSpec
│   │   ├── validator.ts         ← DesignSpec validation → ValidationError[]
│   │   └── template.ts          ← template export / slot injection
│   ├── engine/
│   │   ├── token-resolver.ts    ← $token → theme value
│   │   ├── shorthand-expander.ts← pos shorthand → x/y/width/height
│   │   └── component-resolver.ts← component ref → inlined layers
│   ├── editor/                  ← browser visual editor (canvas, state, interactions)
│   ├── ui/                      ← panels, toolbar, command palette
│   ├── export/                  ← SVG / HTML / PDF exporters; html-assembler (report runtime); mode-b-runtime; script-sandbox; puppeteer-pdf
│   ├── themes/                  ← built-in theme definitions (dark-tech, light-clean)
│   └── utils/                   ← debug logger, ruler units
├── tests/
│   ├── e2e/                     ← Playwright end-to-end tests
│   ├── visual/                  ← Playwright visual regression snapshots
│   └── fixtures/                ← sample .design.yaml files
└── src/**/*.test.ts             ← 1,935 Vitest unit + integration tests
```

---

## Development

### Local Testing

```bash
# Install dependencies
npm ci        # Node
bun install   # Bun (faster)

# Run all unit + integration tests (1,870 tests)
npm run test:unit

# Run with coverage report
npm run test:coverage

# Type check (zero errors policy)
npm run typecheck

# Lint (zero warnings policy)
npm run lint

# E2E tests (build first)
npm run build && npm run test:e2e
```

### Run a single MCP tier locally

```bash
# Tier 1 — Basic tools only (10 tools, ideal for small models)
FOLIO_MCP_TIER=1 bun run src/mcp/index.ts

# Tier 2 — Basic + Design tools (19 tools)
FOLIO_MCP_TIER=2 bun run src/mcp/index.ts

# Tier 3 — All tools (25 tools)
FOLIO_MCP_TIER=3 bun run src/mcp/index.ts
```

### Start the visual editor

```bash
npm run dev   # → http://localhost:5173
```

---

## License

MIT
