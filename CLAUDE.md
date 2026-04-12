# CLAUDE.md — Folio Design Engine
# Local-first YAML graphic design engine | LLM-first architecture
# v2.0.0 | Phase 1 Active

---

## 0. AGENT PRINCIPLES

### 0.1 Caveman Compress — Output Style

Write dense. Every token earns its place.

```
REMOVE:  articles (a, an, the) where meaning stays clear
REMOVE:  filler (really, certainly, just, simply, basically)
REMOVE:  hedging (might, could, should consider, it's worth noting)
REMOVE:  pleasantries (great question, certainly, of course)
USE:     → instead of "leads to / produces / results in"
USE:     ✓/✗ instead of "yes/no, allowed/not allowed"
USE:     tables > prose for comparisons
USE:     bullets > paragraphs for lists
USE:     symbols: ~ (approx), < > (bounds), × (scale), ± (tolerance)
```

Example:
```
BEFORE: "You should always make sure to run the test suite before pushing any changes."
AFTER:  "Run tests before push."
```

Code blocks, URLs, file paths, commands, version numbers — never compress.

### 0.2 Incremental Code Writing

Never write >150 lines of code in single response. Split large files into parts.

```
Protocol for large files:
  Step 1: Declare structure (interfaces, function signatures, imports)
  Step 2: Implement section 1 → commit/confirm
  Step 3: Implement section 2 → commit/confirm
  ...continue until complete

Why: prevents timeout, allows review, easier to debug

Trigger: any file >150 lines, any module with >3 functions
Method: Write skeleton first, then Edit to fill each function
Never: dump 300+ line file in one shot
```

### 0.3 Coding Best Practices

```
TypeScript:
  ✓ strict mode always (noImplicitAny, strictNullChecks)
  ✓ explicit return types on all public functions
  ✓ no `any` — use `unknown` + narrow, or proper generics
  ✓ no `!` non-null assertions — handle null explicitly
  ✗ no console.log in production (use debug utility)
  ✗ no TODOs/FIXMEs in merged code
  ✗ no unused variables, imports, exports

Code structure:
  ✓ single responsibility per file/function
  ✓ pure functions where possible (same input → same output)
  ✓ explicit error handling on every async call
  ✓ tests written alongside code, not after
  ✗ no style string blobs (blocks animation — see §9.2)
  ✗ no Math.random() in render path (seed with layer id)
  ✗ no Date.now() in render path

Naming:
  ✓ semantic IDs (id: headline, not id: layer_001)
  ✓ descriptive function names (renderGradientFill, not render2)
  ✓ consistent casing: camelCase functions, PascalCase types, kebab-case files
```

### 0.4 Git Workflow

```
Branch:   claude/refactor-claude-md-TpXBO  ← develop here
Push:     git push -u origin <branch>
Retry:    up to 4× on network failure (backoff: 2s, 4s, 8s, 16s)
Commits:  clear descriptive messages, one logical change per commit
Never:    push to main/master directly
Never:    --no-verify, --force without explicit user approval
PRs:      only when user explicitly requests
```

---

## 1. PROJECT

### 1.1 Philosophy

```
LLM    = intent generator    → writes semantic shorthand YAML
Engine = spec compiler       → expands shorthand → full render tree
Editor = visual spec editor  → GUI over the YAML
Disk   = verbose spec store  → .design.yaml files
MCP    = tool surface        → LLM ↔ engine bridge
```

Design file IS the product. HTML canvas = view only.
LLM and human editor = both YAML writers.

### 1.2 Phases

```
Phase 1 (CURRENT): Editor + Engine
  YAML/JSON spec · SVG renderer · Monaco editor · canvas interactions
  export pipeline · project file system

Phase 2: MCP Integration
  MCP stdio server · semantic shorthand parser · full tool surface
  incremental page generation · Puppeteer PDF · batch generation

Phase 3: Animation (future)
  CSS animations · keyframe timeline · animated HTML/GIF/MP4/Lottie export
```

### 1.3 Use Cases

1. How-to posters — template + slots, LLM fills content
2. Single-page posters — custom layout, LLM generates layer spec
3. Carousel / slide decks — paged, incremental generation
4. Technical diagrams — Mermaid + shapes + data viz
5. Batch generation — 1 template × N content variations

### 1.4 Not This

- Not Photoshop (no pixel editing, no heavy raster)
- Not Canva (no cloud, no AI image generation)
- Not a web app builder (output = design files, not interactive apps)
- Not multiplayer (single user, local file system)

---

## 2. TECH STACK

### 2.1 Frontend

| Category | Choice | Reason |
|---|---|---|
| Build | Vite + TypeScript | fast dev, clean build |
| Framework | Vanilla TS (no React/Vue) | own render loop, no VDOM fighting SVG |
| Render target | SVG-in-HTML | vector-native, exportable |
| Drag/resize | interact.js | lightweight, MIT, resize+rotate |
| Editor | Monaco | VS Code engine, best YAML support |
| YAML | js-yaml | full Unicode, parse/serialize |
| Tooltips | Floating UI | ~15KB, lightweight |
| Fonts | fontsource (npm) | self-hosted, variable fonts preferred |

### 2.2 Embedded Renderers

| Renderer | Load | Size |
|---|---|---|
| marked.js (Markdown→HTML) | always | ~20KB |
| mermaid (DSL→SVG) | lazy | ~500KB |
| vega-lite (JSON→SVG chart) | lazy | ~400KB |
| katex (LaTeX→HTML) | lazy | ~280KB |
| prism.js (syntax highlight) | lazy | ~30KB |
| lucide SVG sprite (icons) | always | ~150KB |
| dom-to-image-more (PNG/JPEG) | lazy | ~20KB |
| Monaco Editor | once cached | ~2MB |

### 2.3 Export

| Phase | Method | Quality |
|---|---|---|
| P1 | dom-to-image-more | PNG/JPEG good |
| P1 | jsPDF + dom-to-image | PDF acceptable |
| P1 | DOM SVG serialize | SVG perfect |
| P2 | Puppeteer (headless Chrome) | PDF pixel-perfect |

### 2.4 Never Allowed

```
✗ React / Vue / Angular / Svelte
✗ jQuery, Lodash, axios, moment.js, date-fns
✗ Any UI component library (Bootstrap, Tailwind, etc.)
✗ CDN loads at runtime (fonts.googleapis.com, unpkg, cdnjs)
✗ External API calls at runtime
```

### 2.5 MCP Server (Phase 2)

```
Runtime:   Node.js + TypeScript
Transport: stdio (local only, no HTTP)
Storage:   flat files (.design.yaml, .theme.yaml)
No DB · No cloud · No auth required
```

---

## 3. FILE FORMAT

### 3.1 Project Structure

```
my-project/
├── project.yaml               ← manifest (entry point)
├── themes/
│   └── dark-tech.theme.yaml
├── components/
│   ├── index.yaml             ← component registry
│   └── step-badge.component.yaml
├── templates/
│   ├── index.yaml             ← template registry
│   └── how-to-poster.template.yaml
├── designs/
│   └── mcp-carousel.design.yaml
├── assets/
│   ├── fonts/Inter-Variable.woff2
│   ├── icons/custom-logo.svg
│   └── images/diagram-base.png
└── exports/
```

### 3.2 File Protocols

| File | Protocol | Single responsibility |
|---|---|---|
| `project.yaml` | `project/v1` | Manifest, registry, config only |
| `*.theme.yaml` | `theme/v1` | Design tokens only |
| `*.component.yaml` | `component/v1` | One reusable component |
| `*.template.yaml` | `template/v1` | One template layout |
| `*.design.yaml` | `design/v1` | One design document |

Dependency direction (one-way only):
```
design → template → component → theme
Never: theme referencing design, circular refs of any kind
```

Format: YAML on disk (comments, readable, LLM-friendly) → JSON in memory (fast parse).

### 3.3 project.yaml

```yaml
_protocol: "project/v1"
meta:
  id: "uuid-stable"
  name: "Project Name"
  version: "1.0.0"
  created: "2026-04-09"
config:
  default_theme: dark-tech
  default_canvas: "1080x1080"
  grid: { columns: 12, gutter: 24, margin: 80, baseline: 8 }
themes:
  - { id: dark-tech, path: themes/dark-tech.theme.yaml, active: true }
components:
  registry: components/index.yaml
templates:
  registry: templates/index.yaml
designs:
  - { id: my-carousel, path: designs/my-carousel.design.yaml, type: carousel, pages: 10, status: draft }
assets:
  fonts:
    - { id: inter, path: assets/fonts/Inter-Variable.woff2, family: "Inter", variable: true }
```

### 3.4 theme.yaml (tokens)

```yaml
_protocol: "theme/v1"
name: "Dark Tech"
colors:
  background: "#1A1A2E"
  surface: "#16213E"
  primary: "#E94560"
  secondary: "#3D9EE4"
  text: "#FFFFFF"
  text_muted: "#8892A4"
typography:
  scale:
    display: { size: 96, weight: 800, line_height: 1.0 }
    h1:      { size: 72, weight: 700, line_height: 1.1 }
    h2:      { size: 48, weight: 700, line_height: 1.2 }
    body:    { size: 18, weight: 400, line_height: 1.6 }
    label:   { size: 12, weight: 600, line_height: 1.0 }
  families: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" }
spacing:
  unit: 8
  scale: [0, 4, 8, 16, 24, 32, 48, 64, 80, 96, 128]
effects:
  shadow_card: "0 4px 24px rgba(0,0,0,0.4)"
  shadow_glow: "0 0 32px rgba(233,69,96,0.3)"
  blur_glass: 12
radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 }
```

### 3.5 design.yaml — poster (single page)

```yaml
_protocol: "design/v1"
_mode: complete          # complete | in_progress
meta:
  id: "uuid"
  name: "MCP Concepts Poster"
  type: poster           # poster | carousel
  generator: "human"
  generation: { status: complete, total_pages: 1, completed_pages: 1 }
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
theme:
  ref: dark-tech
  overrides:
    primary: "#3D9EE4"
layers:
  - id: bg
    type: rect
    z: 0
    pos: [0, 0, 1080, 1080]
    fill: { type: linear, angle: 135, stops: [{color: "$background", position: 0}, {color: "$surface", position: 100}] }
  - id: headline
    type: text
    z: 20
    pos: [80, 200, 920, auto]
    content: { type: plain, value: "5 Ways to Optimize Your MCP Server" }
    style: { font_family: "$heading", font_size: 72, font_weight: 800, color: "$text", line_height: 1.1 }
```

### 3.6 design.yaml — carousel (paged)

```yaml
_protocol: "design/v1"
_mode: in_progress
meta:
  id: "uuid"
  type: carousel
  generation: { status: in_progress, total_pages: 10, completed_pages: 4 }
document: { width: 1080, height: 1080, unit: px }
theme: { ref: dark-tech }
pages:
  - id: page_1
    label: "Cover"
    template_ref: carousel-cover
    slots:
      title: "Setting Up a Local MCP Server"
      subtitle: "A step-by-step developer guide"
      accent: "$primary"
      page_number: 1
  - id: page_2
    label: "Step 1"
    template_ref: step-page
    slots: { step_number: "01", step_title: "Install Node.js", icon: "download", accent: "$primary", page_number: 2 }
```

---

## 4. LAYER SYSTEM

### 4.1 Z-Index Bands

| Band | Range | Use |
|---|---|---|
| background | 0–9 | bg colors, textures, full-bleed shapes |
| structural | 10–19 | layout shapes, cards, containers |
| content | 20–49 | text, icons, images, charts, diagrams |
| overlay | 50–69 | decorative overlays, color washes |
| foreground | 70–89 | accent shapes, highlights |
| ui | 90–99 | EDITOR ONLY — handles, guides |

Rules: never sequential (1,2,3). All z unique per page scope.

### 4.2 Layer Types

| type | key attrs |
|---|---|
| rect | x,y,w,h, fill, stroke, radius |
| circle | cx,cy,rx,ry, fill, stroke |
| path | d (SVG path string), fill, stroke |
| polygon | points or named shape, fill, stroke |
| line | x1,y1,x2,y2, stroke |
| text | content{type,value}, style, spans |
| image | src, fit, crop |
| icon | name (lucide), size, color |
| component | ref, slots, overrides |
| component_list | component_ref, items[], gap |
| mermaid | definition (string) |
| chart | spec (vega-lite JSON) |
| code | language, code, theme |
| math | expression (LaTeX string) |
| group | layers[] (children) |

### 4.3 Fill Types

```yaml
fill: { type: solid, color: "$primary", opacity: 1.0 }
fill: { type: linear, angle: 135, stops: [{color, position},...] }
fill: { type: radial, cx: 50, cy: 50, radius: 70, stops: [...] }
fill: { type: conic, cx: 50, cy: 50, stops: [...] }
fill: { type: multi, layers: [{type, opacity, stops},...] }
fill: { type: none }
# Noise overlay (in multi layers):
# { type: noise, opacity: 0.03, frequency: 0.65, octaves: 4 }
```

Gradient stops: `{ color: hex_or_token, position: 0-100 }`

### 4.4 Token Syntax

```yaml
color: "$primary"          # → theme.colors.primary
font_family: "$heading"    # → theme.typography.families.heading
shadow: "$shadow_card"     # → theme.effects.shadow_card
color: "{{accent}}"        # → component prop (inside component def)
src: "$project.assets.images.diagram-base"
```

### 4.5 Position Shorthand

```yaml
# Explicit
x: 80
y: 200
width: 920
height: 480

# Array [x, y, w, h]
pos: [80, 200, 920, 480]

# Grid-relative
pos:
  mode: grid
  col_start: 1
  col_span: 12
  row_start: 3
  baseline_offset: 4

# Auto height (text)
height: auto
```

---

## 5. MUTATION PROTOCOL

### 5.1 Operations

```yaml
# CREATE — init new document (once per design)
_operation: create
_target: ./designs/mcp-guide.design.yaml

# APPEND — add pages or layers
_operation: append
_target: ./designs/mcp-guide.design.yaml
_append_to: pages

# PATCH — surgical field update by selector
_operation: patch
_target: ./designs/mcp-guide.design.yaml
_selectors:
  - { path: pages[id=page_1].slots.title, value: "New Title" }
  - { path: theme.overrides.primary, value: "#3D9EE4" }

# MERGE — combine two design files
_operation: merge
_target: ./designs/mcp-guide.design.yaml
_source: ./designs/mcp-guide-steps.design.yaml
_strategy: append_pages   # append_pages | replace_theme | merge_layers
```

### 5.2 Token Budget

| Level | Who writes | Tokens/design | Use case |
|---|---|---|---|
| 1 — Slot fill | LLM | ~50–150 | Template-based, batch gen |
| 2 — Semantic shorthand | LLM | ~300–600 | Custom single-page |
| 3 — Full verbose YAML | Engine/human | ~2000–4000 | On disk, Monaco editor |

LLM never writes Level 3. Engine expands Level 1–2 → Level 3.

10-page carousel total: ~900–1500 tokens output (fits 8K local LLM limit).

### 5.3 Incremental Carousel Flow

```
Call 1: create_design   → scaffold + theme + pages: []         ~100 tokens
Call 2: append_page     → cover slots only                     ~150 tokens
Call 3–N: append_page   → one content page per call            ~80 tokens each
Call N+1: seal_design   → _mode: complete                      ~20 tokens
Call N+2: export_design → trigger export                       0 tokens
```

Resumable: `meta.generation.completed_pages` tracks progress. Crash → resume from last page.

### 5.4 ID Stability Rules

- IDs: semantic not sequential (`id: headline` not `id: layer_001`)
- Same element across regenerations → same ID
- IDs scoped per page (same id in diff pages = valid)
- Stable IDs → readable YAML diffs on regeneration

---

## 6. EDITOR SPEC

### 6.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  [logo] Project: MCP Guide     [theme] [zoom] [export]  │
├──────────────┬────────────────────────────┬─────────────┤
│  FILE TREE   │       CANVAS AREA          │  PROPERTIES │
│              │  (centered, fixed ratio)   │  PANEL      │
│  ▼ Designs   │  click→select             │             │
│  ▼ Templates │  drag→move                │  context-   │
│  ▼ Components│  handles→resize           │  aware per  │
│  ▼ Themes    │  dbl-click→edit text      │  layer type │
├──────────────┴────────────────────────────┴─────────────┤
│  LAYER PANEL  ▼ content (20-49)  ▼ structural  bg       │
├─────────────────────────────────────────────────────────┤
│  [VISUAL MODE]  [PAYLOAD MODE]   ← live bidirectional   │
└─────────────────────────────────────────────────────────┘
```

Key differentiator: one-click toggle visual ↔ YAML (Monaco).
Edit YAML → canvas re-renders. Move element → YAML updates.

### 6.2 Selection & Transform

```
Click          → select, show handles
Shift+click    → multi-select
Drag marquee   → box select
Double-click   → enter group / text edit
Escape         → deselect / exit group

Handles:
  corners        → resize (Shift = lock aspect)
  edge midpoints → resize one axis
  rotation       → rotate (Shift = snap 15°)
  Alt held       → transform from opposite corner
```

### 6.3 Keyboard Shortcuts

```
V/T/R/C/L    select/text/rect/circle/line tool
G            toggle grid
/            command palette
Cmd+Z/⇧Z    undo/redo
Cmd+C/V      copy/paste (YAML clipboard)
Cmd+D        duplicate layer
Cmd+G        group selected
Cmd+[/]      send backward/forward
Cmd+0/1      fit canvas / 100% zoom
Cmd+E        export
Cmd+S        save
```

### 6.4 Command Palette (/)

Search everything: "add step badge", "export PDF", "toggle grid", "new page", "open payload", "apply dark-tech theme"

### 6.5 Alignment Tools

Multi-select shows toolbar:
- Align: left/center/right/top/middle/bottom edge
- Distribute: horizontal/vertical equal spacing
- Match: width/height
- Smart guides: snap to layer edges, centers, canvas center, grid

### 6.6 Layer Panel

```
Groups by z-band (collapsible). Each row: [eye] [lock] [type icon] [name] [z]
Right-click: Rename, Duplicate, Delete, Lock/Unlock, Hide/Show, Copy as YAML
Search by name. Virtual scroll — handles 200+ layers (fixed 32px rows, ~20 DOM nodes).
```

### 6.7 Properties Panel

```
rect:      position, fill (picker/gradient), stroke, radius, shadow, effects, constraints
text:      content textarea, font (family/size/weight/lh/ls), color, alignment, spans
component: slot form fields, prop overrides (internal layers not editable)
```

### 6.8 File Watcher

```
project.yaml      → refresh file tree
*.theme.yaml      → re-resolve tokens, re-render all open designs
*.component.yaml  → re-render all designs using component
*.design.yaml     → re-render if open
*.template.yaml   → refresh template preview
```

Enables: VS Code YAML edits → live update in editor. MCP append_page → instant new slide.

---

## 7. RENDERERS & EXPORT

### 7.1 Renderer Map

| Layer type | Renderer | Output |
|---|---|---|
| rect/circle/path/polygon/line | Native SVG primitives | SVG |
| text (plain/rich/spans) | SVG `<text>/<tspan>` | SVG |
| text (markdown) | marked.js | HTML |
| mermaid | mermaid.js | SVG |
| chart | vega-lite | SVG |
| math | KaTeX | HTML |
| code | Prism.js | HTML |
| icon | Lucide SVG sprite | SVG |
| image | SVG `<image>` | SVG |
| effects | SVG filters | SVG `<filter>` |

### 7.2 SVG Filters

```
feTurbulence      → noise texture, grain, paper feel
feDisplacementMap → wave/liquid distortion
feColorMatrix     → duotone, sepia, hue rotate, desaturate
feGaussianBlur    → soft glow, depth of field
feComposite       → masking operations
feMorphology      → erode/dilate (stroke swell)
feBlend           → blend mode between layers
feDropShadow      → drop shadow shorthand
```

GPU-accelerated, resolution-independent, output as SVG.

### 7.3 Font Loading

```
1. Read assets.fonts from project.yaml
2. FontFace API: new FontFace('Inter', 'url(assets/fonts/Inter-Variable.woff2)')
3. await font.load() → document.fonts.add(font)
4. await document.fonts.ready → then first render (prevents layout shift)
5. Export: embed fonts as base64 WOFF2 (guarantees parity editor ↔ export)
```

### 7.4 Icon System

```
Library: Lucide (~1400 icons, MIT, consistent style, SVG-native)
Usage:   { type: icon, name: "download", size: 24, color: "$primary" }
Resolve: name → SVG path from local bundled sprite (no network)
Custom:  place .svg in assets/icons/, ref as { name: "custom:my-logo" }
```

### 7.5 Export Targets

| Format | Method | Quality | Phase |
|---|---|---|---|
| PNG | dom-to-image-more | good | P1 |
| JPEG | dom-to-image-more | good | P1 |
| SVG | serialize DOM | perfect | P1 |
| PDF | jsPDF + dom-to-image | acceptable | P1 |
| HTML (self-contained) | inline all assets | perfect | P1 |
| PDF (high-fidelity) | Puppeteer | excellent | P2 |

Scale factors: ×1 preview, ×2 standard PNG, ×3 print-ready (300dpi).

Self-contained HTML = fonts (base64 WOFF2) + images (data URIs) + icons (inline SVG) + design YAML in `<script type="application/yaml">`. Opens in any browser, readable in any editor.

### 7.6 Export Rules

```
✓ Editor and exporter use EXACT same SVG pipeline
✓ Font loading complete before any export triggered
✓ Canvas at 100% zoom before capture (scale applied after)
✓ Same YAML → identical pixel output (deterministic)
✗ Never render differently for export
✗ No Math.random() in render path — seed noise with layer id
✗ No Date.now() or window.innerWidth in render path
```

---

## 8. MCP TOOLS (Phase 2)

### 8.1 Tool Surface

```typescript
// PROJECT
create_project(name, theme?, canvas?)    → project_id, path
open_project(path)                       → metadata, design list
list_designs(project_id)                 → design metadata[]

// DESIGN LIFECYCLE
create_design(project_id, template?, theme_override?, canvas?)  → design_id, path
append_page(design_id, template_ref?, slots?, layers?)          → page_id, count
patch_design(design_id, selectors: [{path, value}])             → patched paths
seal_design(design_id)                                          → summary
duplicate_design(project_id, design_id, new_name)               → new design_id

// CONTENT
update_slot(design_id, page_id, slot, value)      → updated slot
add_layer(design_id, page_id?, layer_spec)         → layer_id
update_layer(design_id, layer_id, props)           → updated layer
remove_layer(design_id, layer_id)                  → removed id
reorder_layers(design_id, page_id?, order: id[])   → new order

// COMPONENTS
list_components(project_id)                              → index + props
insert_component(design_id, ref, slots, pos, page_id?)  → layer_id
save_as_component(design_id, layer_ids[], name)          → component_id

// THEME
list_themes(project_id)             → themes + token preview
apply_theme(project_id, theme_id)   → affected design count

// EXPORT
export_design(design_id, format, path?, scale?)     → output path, size
export_page(design_id, page_id, format, path?)      → output path
batch_export(design_ids[], format, output_folder)   → output paths[]

// BATCH
batch_create(template_id, slots_array[], project_id)  → design_ids[], paths[]
resume_design(design_id)   → continues from last completed_pages
```

### 8.2 Semantic Shorthand (LLM writes this)

```yaml
# LLM passes to append_page:
template_ref: step-page
slots:
  step_number: "03"
  step_title: "Configure the YAML file"
  icon: settings
  accent: $primary
# Server expands → full page YAML. LLM never writes verbose form.
```

### 8.3 Context Compression for Local LLM

```
Each tool call gets compressed summary:
  "Design: mcp-guide carousel. Done: [cover, intro, step-1, step-2].
   Next: step-3. Theme: dark-tech. Template: step-page.
   Slots: step_number, step_title, step_body, icon, accent."

LLM responds with slots only (~50 tokens).
Server handles file ops. LLM never sees accumulated YAML.
```

---

## 9. ANIMATION SCHEMA (Phase 3 — define now, implement later)

### 9.1 Animation Schema

```yaml
# Entrance/Exit (CSS)
animation:
  enter: { type: fade_up, delay: 0, duration: 600, easing: ease-out }
  exit:  { type: fade_down, duration: 300 }

# Loop (CSS)
animation:
  loop: { type: float, duration: 3000, amplitude: 8 }
  loop: { type: pulse, scale: 1.02, duration: 1500 }
  loop: { type: glow, color: $primary, duration: 2000 }

# Stagger sequence
sequence:
  stagger: 150
  items:
    - { ref: step_1, animate: fade_up }
    - { ref: step_2, animate: fade_up }

# Keyframe timeline (full motion graphics)
keyframes:
  - { t: 0,    x: 540, y: 540, opacity: 1.0, fill.color: "$primary" }
  - { t: 1000, x: 540, y: 300, opacity: 0.6, fill.color: "$secondary" }
playback: { duration: 2000, loop: true, easing: ease-in-out }
```

Phase 3 exports: Animated HTML, MP4/WebM (Puppeteer+FFmpeg), GIF, Lottie JSON, APNG.

### 9.2 The One Rule That Enables Animation (enforced Phase 1)

**Never use style string blobs. Always use discrete typed properties.**

```yaml
# WRONG — blocks animation forever:
misc_styles: "color:#fff;opacity:0.5;transform:rotate(45deg)"

# RIGHT — fully animatable:
color: "#FFFFFF"
opacity: 0.5
rotation: 45
```

Schema validation rejects style string blobs. This rule cannot be relaxed.

---

## 10. PERFORMANCE

### 10.1 Hard Targets (non-negotiable)

```
Cold start:                 < 1s
Parse + first render (50L): < 100ms
Layer drag feedback:        < 16ms  (60fps)
PNG export 1080×2:          < 3s
Monaco editor load:         < 500ms
Initial JS bundle (gzip):   < 500KB (excl. Monaco)
Memory (50-layer design):   < 50MB
Memory (200-layer design):  < 150MB
```

Feature cannot meet targets → defer/redesign feature, not targets.

### 10.2 Dirty Tracking (render only what changed)

```
Each layer cache: { svg: SVGElement, hash: string, dirty: boolean }

On change:
  1. Compute new prop hash for affected layers
  2. Compare to cache hash
  3. Different → mark dirty, re-render only that layer
  4. Same → use cache, ~0 cost

Full re-render triggers: theme change, zoom change, canvas resize only.
```

### 10.3 Lazy Renderer Loading

```
Initial bundle (~500KB, always loaded):
  SVG primitives · text renderer · icon sprite · marked.js · token resolver

Lazy on first use:
  mermaid     → import('mermaid')          when type:mermaid first seen
  vega-lite   → import('vega-lite')        when type:chart first seen
  katex       → import('katex')            when type:math first seen
  prism.js    → import('prismjs')          when type:code first seen
  dom-to-image→ import('dom-to-image-more') on export trigger
  interact.js → import('interactjs')       on editor mode activate
```

Mermaid/Vega-Lite: always cache SVG after first render. Re-render only on content change. Cached = ~0.1ms.

### 10.4 Render Cost Budget

```
rect/circle/line/polygon:  ~0.1ms   pure SVG
text (plain):              ~0.3ms   SVG text + font metrics
text (markdown):           ~2ms     marked.js parse
icon:                      ~0.2ms   sprite lookup
image:                     ~5ms     decode + embed
mermaid:                   ~50ms    first render only (cache after)
vega-lite chart:           ~30ms    first render only (cache after)
katex math:                ~5ms     first render only
code (prism):              ~3ms     tokenize + render
```

---

## 11. INTERACTIVE HTML OUTPUT

### 11.1 Two Modes

```
Mode A: Presentation (Phase 1)
  → navigational/decorative interactions, hover effects, slide navigation
  → output: self-contained HTML + CSS + minimal JS

Mode B: Interactive Document (Phase 2+)
  → state, data binding, user-defined TS scripts
  → output: self-contained HTML + compiled TS runtime
```

### 11.2 Mode A Interaction Schema

```yaml
- id: next_button
  type: rect
  interaction:
    on_click: { action: next_page }  # next_page|prev_page|goto_page|open_url
    on_hover: { scale: 1.03, shadow: $shadow_glow, transition: 200ms ease }
    cursor: pointer
```

### 11.3 Mode B Schema (state + scripts)

```yaml
_output_mode: interactive
state:
  currentStep: { type: number, default: 0 }
  showDetails: { type: boolean, default: false }
data:
  steps:
    type: static_array
    value: [{title: "Install", done: false}, {title: "Configure", done: false}]
scripts:
  - id: on_next_click
    language: typescript
    code: |
      state.currentStep = Math.min(state.currentStep + 1, data.steps.length - 1)
```

Dynamic layer attrs (Mode B): `content: { type: expression, value: "\`Step ${state.currentStep + 1}\`" }`

### 11.4 Script Sandbox

```
Available in script context: state, data, event, pages, assets, utils
NOT available: window, document, fetch, XMLHttpRequest, eval, require

Sandbox: iframe (sandbox="allow-scripts") + postMessage only
State runtime: custom ~2KB — setState(k,v), getData(id), trigger(scriptId, event)
No framework — no React/Vue/Svelte

Built-in actions (no custom script needed):
  next_page | prev_page | goto_page(id) | toggle_state(key)
  set_state(key, val) | open_url(url) | copy_text(val) | reset_state
```

---

## 12. TESTING

### 12.1 Stack

```
Vitest              unit + integration (Vite-native)
@vitest/coverage-v8 code coverage
Playwright          E2E + visual regression (Chromium/Firefox/WebKit)
@vitest/ui          test dashboard
vitest-canvas-mock  mock canvas API in unit tests
```

### 12.2 Coverage Targets

| Module | Target |
|---|---|
| Token resolver | 98% |
| Schema validation | 95% |
| SVG renderer | 90% |
| MCP tools | 90% |
| Export pipeline | 85% |
| Component system | 85% |
| Canvas interactions | 80% |
| Overall | >80% |

CI blocks merge if any module below target.

### 12.3 Test Conventions

```
Unit tests: co-located (src/renderer/rect.ts → rect.test.ts)
E2E tests:  tests/e2e/*.spec.ts  (Playwright)
Visual:     tests/visual/snapshots/ (baseline PNGs, ≤1% diff tolerance)
Fixtures:   tests/fixtures/designs/ (minimal .design.yaml per feature)
Benchmarks: vitest bench — fail if >30% slower than baseline
```

### 12.4 Key Test Assertions

```
Schema:   valid YAML parses, invalid throws, $token resolves, duplicate IDs detected
Renderer: each layer type → correct SVG output, same input → identical output (determinism)
Tokens:   $primary → correct hex, overrides take precedence, missing → fallback #FF00FF
Export:   PNG valid + correct dimensions, HTML self-contained (no external URLs), font embedded
Canvas:   click→select, drag→x,y updated, undo→previous position, snap works
MCP:      create_design→valid file, append_page→count increments, seal_design→mode=complete
```

### 12.5 Definition of Done

```
Code:   ✓ zero TS errors (strict) · no console.log · no TODOs · all errors handled
Tests:  ✓ unit passing · coverage target met · visual snapshot updated · E2E covers flow
CI:     ✓ all checks green · bundle size regression <5% · perf regression <10%
Docs:   ✓ JSDoc on public fns · CLAUDE.md updated if arch changed
```

### 12.6 Scripts

```json
"dev":                "vite"
"build":              "tsc && vite build"
"typecheck":          "tsc --noEmit"
"lint":               "eslint src --ext .ts --max-warnings 0"
"test:unit":          "vitest run"
"test:coverage":      "vitest run --coverage"
"test:visual":        "playwright test tests/visual/"
"test:e2e":           "playwright test tests/e2e/"
"test:bench":         "vitest bench"
"test:update-snapshots": "playwright test --update-snapshots"
```

---

## 13. PRINCIPLES

### 13.1 Zero Silent Failures

```
YAML parse error     → Monaco inline error + Problems panel
Token not found      → render placeholder + warning
Component not found  → render "missing component" box + error
Layer type unknown   → render "unknown layer" placeholder + error
Export failure       → toast with specific reason
Script runtime error → overlay on affected layer

Never: log to console only · silently skip layer · render partial output
```

### 13.2 Schema Validation (always on)

```
Runs: on file open · every YAML edit (debounce 300ms) · on export · on MCP write

Catches:
  unknown layer types · missing required fields (id, type, z, x, y, w, h)
  duplicate layer IDs · duplicate z-index per page scope
  token refs to nonexistent keys · component refs to missing files
  WCAG AA contrast failures (warning) · pos array wrong length
  circular component dependencies
```

### 13.3 Accessibility

```
All exported HTML must:
  ✓ alt text on image layers (meta.alt_text field)
  ✓ semantic heading hierarchy (h1>h2>h3)
  ✓ ARIA labels on interactive elements
  ✓ keyboard navigable (Tab through interactive)
  ✓ WCAG AA contrast (4.5:1 body, 3:1 large text)
  ✓ lang attribute on html element
```

### 13.4 Security

```
✓ All YAML through schema validator before use
✓ Scripts: sandboxed iframe (sandbox="allow-scripts") + postMessage only
✓ Strict CSP on exported HTML
✓ File system: read/write within user project folder only
✓ npm audit on every CI run
✗ No eval() in production (except sandboxed runner)
✗ No external network at runtime
✗ No hardcoded secrets
```

### 13.5 Versioning

```
_protocol: "type/vN" on every file
Semver: PATCH (bug fix, auto-release) · MINOR (feature, manual) · MAJOR (breaking, migration required)
Breaking: deprecate 1 minor version first, remove in next major
Never rename fields — add new, deprecate old, remove after migration
Engine compatible N-2 versions back
```

### 13.6 Multiplatform

```
Full support:    Chrome 120+ desktop/Android · Safari 17+ desktop/iOS · Firefox 121+
Degraded:        older Chrome → notify + suggest update
Not supported:   IE11 · Opera Mini

Tier 1 (≥1024px): full editor, mouse+keyboard
Tier 2 (768-1023px): full editor, touch-adapted (44×44 min targets, panels as drawers)
Tier 3 (<768px): view + text slot editing only, no drag/resize, no Monaco

Pointer events (not mouse events) everywhere — handles mouse, touch, stylus.
File system: FSA on desktop Chrome, <input type="file"> + download fallback elsewhere.
```

---

## 14. DECISIONS LOG

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Render target | SVG-in-HTML | Canvas API, WebGL | vector-native, exportable |
| Canvas lib | none (vanilla) | Fabric.js, Konva.js | full control, no SVG export conflict |
| Framework | Vanilla TS | React/Vue/Svelte | own render loop, no VDOM |
| Source format | YAML | JSON, TOML | comments, LLM-friendly multiline |
| Runtime format | JSON | YAML | fast parse |
| Icon lib | Lucide | FontAwesome, Material | MIT, SVG-native |
| Editor widget | Monaco | CodeMirror, Ace | VS Code engine, best YAML |
| Drag lib | interact.js | Custom, Hammer.js | lightweight, MIT, resize+rotate |
| Z-index | Banded (0-9,10-19...) | Sequential | safe insertion |
| Token syntax | $token | {{token}}, var(--) | short, unambiguous |
| Component props | {{prop}} | $prop | distinct from theme tokens |
| MCP transport | stdio | HTTP/SSE | local-only |
| PDF P1 | jsPDF+dom-to-image | Puppeteer | client-side, no server |
| PDF P2 | Puppeteer | WeasyPrint | pixel-perfect, same Chrome |
| Bundle target | <500KB initial | no limit | forces lazy discipline |
| Render strategy | dirty tracking | full redraw | 60fps drag |
| Offline | hard constraint | nice-to-have | core philosophy |
| Deterministic render | hard constraint | best effort | CI/CD + version control |
| Interactive output | two modes (A+B) | one mode | A simple, B powerful |
| Scripting | TypeScript/JS | custom formula | familiar, LLM-friendly |
| Script sandbox | iframe/SES | none | security |
| State runtime | custom 2KB | React/Vue | no framework |
| Accessibility | required | optional | output quality |

---

## 15. KNOWN RISKS

| Risk | Mitigation |
|---|---|
| Font loading race | await `document.fonts.ready` before render |
| Export ≠ editor parity | same SVG pipeline for both |
| YAML indent errors from LLM | validate on parse, Monaco inline errors |
| Layer ID collisions | enforce unique on save, auto-suffix |
| Z-index conflicts | enforce unique per page scope |
| Emoji/special chars | js-yaml full Unicode mode |
| Local LLM context overflow | incremental calls, slots-only mode |
| Coordinate drift | lock unit=px, origin=top-left, no auto sizing |
| Style string blobs | schema validation rejects them |
| Circular component deps | detect cycles on component save |
| Font render differences (OS) | variable fonts + `-webkit-font-smoothing: antialiased` |

---

## 16. ROADMAP

### Phase 1 — Editor + Engine (Current)

```
Week 1:  project scaffold (Vite+TS+ESLint+Vitest+Playwright)
         schema + token resolver (95% test coverage)
         static renderer: rect, circle, text, icon
         install.sh / install.ps1 / health-check scripts

Week 2:  all fill types (solid, linear, radial, multi, noise)
         all text subtypes (markdown, rich, spans)
         SVG filters (shadow, blur, glow, blend)
         visual regression test baseline (Playwright snapshots)

Week 3:  Monaco editor integration
         bidirectional live sync (YAML ↔ canvas)
         Problems panel (validation errors)

Week 4-5: interact.js: select, drag, resize, rotate
          multi-select + group transform
          undo/redo (immutable state stack)
          snap to grid + snap to layer

Week 6:  layer panel (virtual scroll, z-band groups)
         properties panel (context-aware per type)
         gradient editor · alignment tools

Week 7:  component system (ref, slots, overrides)
         template system (locked layout, slot validation)
         update.sh / release.sh scripts

Week 8:  export: PNG · SVG · HTML (self-contained) · PDF
         project file system (FSA + fallback)
         file watcher (polling)

Week 9:  command palette · keyboard shortcuts
         carousel editor (page strip + thumbnails)
         touch/pointer events · mobile responsive (Tier 3)

Week 10: release.yml pipeline · coverage reporting (Codecov)
         perf benchmarks · bundle size gate (<500KB in CI)
         cross-browser matrix (Playwright) · v1.0.0 tag
```

### Phase 2 — MCP Server

```
MCP stdio scaffold · semantic shorthand parser · full tool surface
incremental generation protocol · Puppeteer PDF · batch_create
context compression for local LLM · resume protocol
```

### Phase 3 — Animation

```
CSS entrance/exit · stagger sequence · animated HTML export
keyframe timeline editor · GIF/MP4/WebM (Puppeteer+FFmpeg) · Lottie JSON
```

---

*CLAUDE.md v2.0.0 — Compressed + Agent Principles added*
