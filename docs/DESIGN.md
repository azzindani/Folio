# DESIGN.md — Folio Design System
# Payload format, layer schema, design tokens, and system spec
# v2.0.0 | Recovered from CLAUDE.md v1.2.0 + codebase audit

---

## 1. PHILOSOPHY

```
LLM    = intent generator    writes semantic shorthand YAML
Engine = spec compiler       expands shorthand → full render tree
Editor = visual spec editor  GUI over YAML
Disk   = verbose spec store  .design.yaml files
MCP    = tool surface        LLM ↔ engine bridge
```

Design file IS the product. HTML canvas = view only.
LLM and human editor are both YAML writers.

### 1.1 Core Principles

- **Local-first** — no cloud, no subscriptions, no internet after install
- **File-based** — designs are human-readable YAML; git-diffable
- **LLM-native** — shorthand format sized for local 8K context windows
- **Transparent format** — editor exposes raw YAML; no black-box JSON
- **Deterministic** — same YAML → identical pixel output, always

### 1.2 Not This

- Not Photoshop (no pixel editing, no heavy raster)
- Not Canva (no cloud, no AI image gen per page)
- Not a web app builder (output = design files, not apps)
- Not multiplayer (single user, local file system)

### 1.3 Inspired By

| Inspiration | What we borrow |
|---|---|
| Canva | JSON-backed design engine, template + slot pattern |
| Power Apps | YAML as source of truth, project manifest |
| Figma | Layer panel, property inspector, component system |
| Penpot | Open file format, self-hostable, SVG-native |
| Obsidian | Local-first folder-as-project, plain text everything |
| Reveal.js | Single HTML file = self-rendering document |
| draw.io | File opens in browser = rendered; in editor = editable |
| Typst | Markup → beautiful output via clean AST |
| VS Code | Monaco editor, command palette, file watcher |
| Vega-Lite | Declarative JSON spec → chart (same philosophy) |

---

## 2. FILE PROTOCOLS

### 2.1 Project Structure

```
my-project/
├── project.yaml               ← manifest (entry point)
├── .designignore              ← exclude from file watcher
├── themes/
│   ├── dark-tech.theme.yaml
│   └── light-clean.theme.yaml
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

### 2.2 File Type Summary

| File | Protocol | Single responsibility |
|---|---|---|
| `project.yaml` | `project/v1` | Manifest, registry, config only |
| `*.theme.yaml` | `theme/v1` | Design tokens only |
| `*.component.yaml` | `component/v1` | One reusable component |
| `*.template.yaml` | `template/v1` | One template layout |
| `*.design.yaml` | `design/v1` | One design document |

**Dependency direction (one-way only):**
```
design → template → component → theme
Never: theme referencing design, circular refs of any kind
```

**Format:** YAML on disk (comments, readable, LLM-friendly) → JSON in memory (fast parse).

### 2.3 Protocol Versioning

```
Every file: _protocol: "type/vN"
Breaking changes → bump major version (e.g. design/v2)
Additive changes → bump minor (documented in CHANGELOG)
Engine compatible N-2 versions back

Field addition (safe):  add optional field with default
Field removal (breaking): deprecate one MINOR first, remove in next MAJOR
Field rename (breaking):  never rename — add new, deprecate old
```

---

## 3. project.yaml

```yaml
_protocol: "project/v1"

meta:
  id: "uuid-stable-never-changes"
  name: "Project Name"
  version: "1.0.0"
  created: "2026-04-09"
  modified: "2026-04-09"
  author: "human"
  tags: []

config:
  default_theme: dark-tech
  default_canvas: "1080x1080"
  default_export_format: pdf
  grid:
    columns: 12
    gutter: 24
    margin: 80
    baseline: 8

themes:
  - id: dark-tech
    path: themes/dark-tech.theme.yaml
    active: true

components:
  registry: components/index.yaml

templates:
  registry: templates/index.yaml

designs:
  - id: my-carousel
    path: designs/my-carousel.design.yaml
    type: carousel          # poster | carousel | motion (Phase 3)
    pages: 10
    status: draft           # draft | review | final
    thumbnail: null

assets:
  fonts:
    - id: inter
      path: assets/fonts/Inter-Variable.woff2
      family: "Inter"
      variable: true
  images: []

exports: []
```

---

## 4. theme.yaml

```yaml
_protocol: "theme/v1"
name: "Dark Tech"
version: "1.0.0"

colors:
  background: "#1A1A2E"
  surface: "#16213E"
  primary: "#E94560"
  secondary: "#3D9EE4"
  text: "#FFFFFF"
  text_muted: "#8892A4"
  border: "#2A2A4A"
  palette:
    indigo_900: "#1A1A2E"
    red_500: "#E94560"

typography:
  scale:
    display: { size: 96, weight: 800, line_height: 1.0 }
    h1:      { size: 72, weight: 700, line_height: 1.1 }
    h2:      { size: 48, weight: 700, line_height: 1.2 }
    h3:      { size: 32, weight: 600, line_height: 1.3 }
    body:    { size: 18, weight: 400, line_height: 1.6 }
    caption: { size: 14, weight: 400, line_height: 1.5 }
    label:   { size: 12, weight: 600, line_height: 1.0 }
  families:
    heading: "Inter"
    body: "Inter"
    mono: "JetBrains Mono"

spacing:
  unit: 8
  scale: [0, 4, 8, 16, 24, 32, 48, 64, 80, 96, 128]

effects:
  shadow_card: "0 4px 24px rgba(0,0,0,0.4)"
  shadow_glow: "0 0 32px rgba(233,69,96,0.3)"
  blur_glass: 12

radii:
  sm: 4
  md: 8
  lg: 16
  xl: 24
  full: 9999
```

**Built-in themes:** `dark-tech` · `light-clean` · `ocean-blue` (see `src/themes/builtin.ts`)

---

## 5. design.yaml — Poster (single page)

```yaml
_protocol: "design/v1"
_mode: complete          # complete | in_progress

meta:
  id: "uuid"
  name: "MCP Concepts Poster"
  type: poster           # poster | carousel | motion
  created: "2026-04-09"
  modified: "2026-04-09"
  generator: "human"    # human | mcp
  generation:
    status: complete
    total_pages: 1
    completed_pages: 1

document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
  aspect_ratio: "1:1"

theme:
  ref: dark-tech
  overrides:
    primary: "#3D9EE4"   # override any token for this design only

layers:
  - id: bg
    type: rect
    z: 0
    x: 0
    y: 0
    width: 1080
    height: 1080
    fill:
      type: linear
      angle: 135
      stops:
        - { color: "$background", position: 0 }
        - { color: "$surface", position: 100 }

  - id: headline
    type: text
    z: 20
    x: 80
    y: 200
    width: 920
    height: auto
    content:
      type: plain
      value: "5 Ways to Optimize Your MCP Server"
    style:
      font_family: "$heading"
      font_size: 72
      font_weight: 800
      color: "$text"
      line_height: 1.1
      align: left
```

---

## 6. design.yaml — Carousel (paged)

```yaml
_protocol: "design/v1"
_mode: in_progress

meta:
  id: "uuid"
  name: "MCP Setup Guide"
  type: carousel
  generator: "mcp"
  generation:
    status: in_progress
    total_pages: 10
    completed_pages: 4
    last_operation: append_page

document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96

theme:
  ref: dark-tech

pages:
  - id: page_1
    label: "Cover"
    template_ref: carousel-cover   # resolves from templates/
    slots:
      title: "Setting Up a Local MCP Server"
      subtitle: "A step-by-step developer guide"
      accent: "$primary"
      page_number: 1

  - id: page_2
    label: "Step 1"
    template_ref: step-page
    slots:
      step_number: "01"
      step_title: "Install Node.js"
      step_body: "Download LTS version from nodejs.org"
      icon: "download"
      accent: "$primary"
      page_number: 2

  - id: page_3
    label: "Custom page"
    # No template_ref — raw layers instead
    layers:
      - id: bg
        type: rect
        z: 0
        pos: [0, 0, 1080, 1080]
        fill: { type: solid, color: "$background" }
```

---

## 7. component.yaml

```yaml
_protocol: "component/v1"
name: "Step Badge"
version: "1.0.0"
description: "Numbered step indicator with icon and label"

props:
  step_number:
    type: string
    default: "01"
    description: "Two-digit step number"
  label:
    type: string
    required: true
  accent:
    type: color
    default: "$primary"

locked_props:
  - width
  - height

layers:
  - id: badge-bg
    type: rect
    z: 0
    x: 0
    y: 0
    width: 200
    height: 60
    fill: { type: solid, color: "{{accent}}" }
    radius: 30

  - id: step-num
    type: text
    z: 10
    x: 16
    y: 8
    width: 44
    height: 44
    content: { type: plain, value: "{{step_number}}" }
    style: { font_size: 24, font_weight: 800, color: "#FFFFFF", align: center }

  - id: step-label
    type: text
    z: 10
    x: 68
    y: 18
    width: 120
    height: 24
    content: { type: plain, value: "{{label}}" }
    style: { font_size: 14, font_weight: 600, color: "#FFFFFF" }
```

Token syntax inside components: `{{propName}}` (resolves from slots at render time).
Theme tokens (`$primary`) still resolve from the active theme.

---

## 9. LAYER SYSTEM

### 9.1 Z-Index Bands

| Band | Range | Use |
|---|---|---|
| background | 0–9 | bg colors, textures, full-bleed shapes |
| structural | 10–19 | layout shapes, cards, containers |
| content | 20–49 | text, icons, images, charts, diagrams |
| overlay | 50–69 | decorative overlays, color washes |
| foreground | 70–89 | accent shapes, highlights |
| ui | 90–99 | EDITOR ONLY — handles, guides (never in files) |

**Rules:**
- Never sequential (1,2,3…) — use banded values for safe insertion
- All z values unique per page scope
- Same semantic element → same z-band across pages

### 9.2 Layer Types Reference

| type | description | key attributes |
|---|---|---|
| `rect` | Rectangle | x, y, width, height, fill, stroke, radius |
| `circle` | Circle/ellipse | x, y, width, height (cx/cy computed), fill, stroke |
| `path` | SVG bezier path | d (SVG path string), fill, stroke |
| `polygon` | N-sided shape | sides (int) or points[], fill, stroke |
| `line` | Straight line | x1, y1, x2, y2, stroke |
| `text` | Text block | content {type, value}, style, spans |
| `image` | Raster/SVG file | src, fit (cover/contain/fill/none), crop |
| `icon` | Lucide icon | name (string), size, color |
| `component` | Component instance | ref, slots, overrides |
| `component_list` | Repeated component | component_ref, items[], gap |
| `mermaid` | Mermaid diagram | definition (DSL string) |
| `chart` | Vega-lite chart | spec (JSON object) |
| `code` | Code block | language, code, theme |
| `math` | KaTeX expression | expression (LaTeX string) |
| `group` | Layer group | layers[] (children, recursive) |

### 9.3 Base Layer Fields (all types)

```yaml
id: headline          # semantic, stable, unique per page scope
type: text            # one of the 15 types above
z: 20                 # z-index within band
x: 80                 # left edge (px from canvas origin)
y: 200                # top edge (px from canvas origin)
width: 920            # px or auto (text only)
height: auto          # px or auto (text only)
rotation: 0           # degrees, applied from center
opacity: 1.0          # 0.0–1.0
visible: true         # false = hidden in editor + export
locked: false         # true = not selectable in editor
effects:              # shadows, blur, blend (see §10.3)
interaction:          # click/hover (Mode A, see §14)
```

### 9.4 Layer Examples

**rect:**
```yaml
- id: card
  type: rect
  z: 10
  x: 80
  y: 300
  width: 920
  height: 480
  fill: { type: solid, color: "$surface" }
  stroke: { color: "$border", width: 1 }
  radius: 16
  effects:
    shadows:
      - { x: 0, y: 4, blur: 24, spread: 0, color: "rgba(0,0,0,0.4)" }
```

**text (plain):**
```yaml
- id: headline
  type: text
  z: 20
  x: 120
  y: 360
  width: 840
  height: auto
  content:
    type: plain
    value: "Design Engine"
  style:
    font_family: "$heading"
    font_size: 72
    font_weight: 800
    color: "$text"
    line_height: 1.1
    align: left           # left | center | right
```

**text (markdown):**
```yaml
- id: body
  type: text
  z: 21
  x: 80
  y: 400
  width: 920
  height: auto
  content:
    type: markdown
    value: |
      ## Section Title
      Body text with **bold** and _italic_ support.
      - List item 1
      - List item 2
```

**text (rich — inline styles):**
```yaml
- id: mixed
  type: text
  z: 22
  x: 80
  y: 500
  width: 920
  height: auto
  content:
    type: rich
    spans:
      - { text: "Normal " }
      - { text: "bold red", bold: true, color: "$primary" }
      - { text: " and ", italic: true }
      - { text: "large", size: 32 }
```

**icon:**
```yaml
- id: download-icon
  type: icon
  z: 25
  x: 80
  y: 400
  width: 48
  height: 48
  name: "download"        # Lucide icon name
  size: 48
  color: "$primary"
```

**mermaid:**
```yaml
- id: flow
  type: mermaid
  z: 30
  x: 80
  y: 200
  width: 920
  height: 480
  definition: |
    flowchart LR
      A[LLM] --> B[MCP Server]
      B --> C[Design Engine]
      C --> D[YAML File]
```

**chart (vega-lite):**
```yaml
- id: bar-chart
  type: chart
  z: 30
  x: 80
  y: 200
  width: 920
  height: 480
  spec:
    mark: bar
    data:
      values:
        - { category: "A", value: 28 }
        - { category: "B", value: 55 }
    encoding:
      x: { field: "category", type: "nominal" }
      y: { field: "value", type: "quantitative" }
```

**image:**
```yaml
- id: hero-img
  type: image
  z: 15
  x: 540
  y: 0
  width: 540
  height: 1080
  src: "assets/images/diagram-base.png"   # project-relative path
  fit: cover                               # cover | contain | fill | none
  meta:
    alt_text: "Architecture diagram"       # accessibility
```

**group:**
```yaml
- id: step-group
  type: group
  z: 20
  x: 80
  y: 200
  width: 920
  height: 300
  layers:
    - id: step-bg
      type: rect
      z: 0
      x: 0
      y: 0
      width: 920
      height: 300
      fill: { type: solid, color: "$surface" }
    - id: step-text
      type: text
      z: 10
      x: 24
      y: 24
      width: 872
      height: auto
      content: { type: plain, value: "Step content here" }
      style: { font_size: 18, color: "$text" }
```

---

## 10. FILLS, EFFECTS & TOKENS

### 10.1 Fill Types

```yaml
# Solid
fill: { type: solid, color: "$primary", opacity: 1.0 }

# Linear gradient
fill:
  type: linear
  angle: 135
  stops:
    - { color: "$background", position: 0 }
    - { color: "$surface", position: 100 }

# Radial gradient
fill:
  type: radial
  cx: 50        # % from left
  cy: 50        # % from top
  radius: 70    # % of bounding box
  stops:
    - { color: "$primary", position: 0 }
    - { color: "transparent", position: 100 }

# Conic gradient (approximated as radial in SVG)
fill:
  type: conic
  cx: 50
  cy: 50
  stops:
    - { color: "$primary", position: 0 }
    - { color: "$secondary", position: 100 }

# Noise overlay (feTurbulence)
fill:
  type: noise
  opacity: 0.03
  frequency: 0.65
  octaves: 4

# Multi-layer (stacked fills)
fill:
  type: multi
  layers:
    - { type: linear, angle: 135, stops: [...] }
    - { type: noise, opacity: 0.03, frequency: 0.65, octaves: 4 }
    - { type: solid, color: "$primary", opacity: 0.1 }

# None
fill: { type: none }
```

Gradient stops: `{ color: hex_or_token, position: 0–100 }`

### 10.2 Stroke

```yaml
stroke:
  color: "$primary"
  width: 2
  dash: [8, 4]          # optional: dasharray values
  linecap: round        # butt | round | square
  linejoin: round       # miter | round | bevel
```

### 10.3 Effects

```yaml
effects:
  shadows:
    - { x: 0, y: 4, blur: 24, spread: 0, color: "rgba(0,0,0,0.4)" }
    - { x: 0, y: 0, blur: 32, spread: 0, color: "rgba(233,69,96,0.3)" }
  blur: 0               # feGaussianBlur (px)
  backdrop_blur: 12     # CSS backdrop-filter blur (px)
  opacity: 1.0
  blend_mode: normal    # normal | multiply | screen | overlay | …
```

### 10.4 Radius

```yaml
radius: 16              # uniform (all corners)
radius:                 # per-corner
  tl: 16
  tr: 16
  br: 4
  bl: 4
```

Note: SVG `<rect>` only supports uniform `rx`. Per-corner approximated as average (full path-based impl pending).

### 10.5 Token Syntax

```yaml
# Theme token reference (resolves at render time)
color: "$primary"              # → theme.colors.primary
font_family: "$heading"        # → theme.typography.families.heading
shadow: "$shadow_card"         # → theme.effects.shadow_card
radius: "$radius_lg"           # → theme.radii.lg

# Component prop reference (inside component definition only)
color: "{{accent}}"            # → resolved from component slots
content: "{{label}}"

# Project asset reference
src: "$project.assets.images.diagram-base"
```

**Token lookup order:** design.theme.overrides → theme.colors → theme.typography.families → theme.effects → theme.radii → deep search in colors.palette

**Missing token fallback:** `#FF00FF` (debug pink — intentionally visible)

### 10.6 Position Shorthand

```yaml
# Explicit (always valid)
x: 80
y: 200
width: 920
height: 480

# Array shorthand [x, y, w, h]
pos: [80, 200, 920, 480]

# Grid-relative (engine expands to px)
pos:
  mode: grid
  col_start: 1
  col_span: 12
  row_start: 3
  baseline_offset: 4

# Auto height (text layers)
height: auto
```

---

## 8. template.yaml

```yaml
_protocol: "template/v1"
name: "Step Page"
version: "1.0.0"
description: "Single step in a how-to carousel"

slots:
  step_number:
    type: string
    required: true
    description: "e.g. 01, 02"
  step_title:
    type: string
    required: true
  step_body:
    type: string
    default: ""
  icon:
    type: string
    default: "circle"
  accent:
    type: color
    default: "$primary"
  page_number:
    type: number
    default: 1

document:
  width: 1080
  height: 1080

layers:
  - id: bg
    type: rect
    z: 0
    pos: [0, 0, 1080, 1080]
    fill: { type: solid, color: "$background" }
  - id: step-badge
    type: component
    z: 20
    x: 80
    y: 80
    ref: step-badge
    slots:
      step_number: "{{step_number}}"
      label: "{{step_title}}"
      accent: "{{accent}}"
```

---

## 11. MUTATION PROTOCOL

Four operations for incremental LLM generation without token exhaustion.

### 11.1 Operations

```yaml
# CREATE — initialize new document (once per design)
_operation: create
_target: ./designs/mcp-guide.design.yaml
# ... full scaffold content

# APPEND — add pages or layers to existing array
_operation: append
_target: ./designs/mcp-guide.design.yaml
_append_to: pages
# ... array items to append

# PATCH — surgical field update by selector
_operation: patch
_target: ./designs/mcp-guide.design.yaml
_selectors:
  - path: pages[id=page_1].slots.title
    value: "New Title Here"
  - path: theme.overrides.primary
    value: "#3D9EE4"

# MERGE — combine two design files
_operation: merge
_target: ./designs/mcp-guide.design.yaml
_source: ./designs/mcp-guide-steps.design.yaml
_strategy: append_pages    # append_pages | replace_theme | merge_layers
```

### 11.2 Token Budget Per Abstraction Level

| Level | Who writes | Format | Tokens/design |
|---|---|---|---|
| L1 Slot fill | LLM | template_ref + slots only | ~50–150 |
| L2 Semantic shorthand | LLM | layer types + token refs + pos shorthand | ~300–600 |
| L3 Full verbose YAML | Engine / human | all attributes explicit | ~2000–4000 |

**Rule: LLM never writes L3.** L3 lives on disk, visible in Monaco. LLM writes L1 or L2.

### 11.3 Incremental Carousel Flow

```
Call 1:  create_design   scaffold + theme + pages: []         ~80–120 tokens
Call 2:  append_page     cover — slots only                   ~100–150 tokens
Call 3–N: append_page ×N  one content page each               ~60–100 tokens each
Call N+1: seal_design    set _mode: complete                  ~20 tokens
Call N+2: export_design  trigger PNG/PDF export               0 tokens

Total 10-page carousel: ~900–1500 tokens output
Each call fits within 2K output limit
```

### 11.4 Resumable Generation

```yaml
meta:
  generation:
    status: in_progress          # in_progress | complete
    total_pages: 10
    completed_pages: 4           # resume from page 5
    last_operation: append_page
```

MCP `resume_design(design_id)` reads `completed_pages` and continues. Partial files are valid + openable.

### 11.5 Layer ID Stability Rules

- IDs must be **stable and semantic**, not auto-incremented
- Same semantic element across regenerations keeps same ID
- `id: headline` always means the headline — git diff stays readable
- IDs scoped per page (same id in different pages = valid)
- Engine auto-suffixes on conflict: `headline` → `headline_2`

```diff
  - id: headline
-   content: "5 Ways to Optimize Your API"
+   content: "7 Ways to Optimize Your MCP Server"
```

---

## 12. EDITOR SPECIFICATION

### 12.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Project: MCP Guide        [theme] [zoom] [export]   │
├──────────────┬──────────────────────────────┬───────────────┤
│  FILE TREE   │       CANVAS AREA            │  PROPERTIES   │
│              │   centered, fixed aspect     │  PANEL        │
│  ▼ Designs   │   ratio, shadowed border     │               │
│  ▼ Templates │                              │  Context-     │
│  ▼ Components│   click → select             │  aware per    │
│  ▼ Themes    │   drag → move                │  layer type   │
│              │   handles → resize           │               │
├──────────────┴──────────────────────────────┴───────────────┤
│  LAYER PANEL  (z-band groups, collapsible)                  │
├─────────────────────────────────────────────────────────────┤
│  [VISUAL MODE]  [PAYLOAD MODE]   ← live bidirectional       │
└─────────────────────────────────────────────────────────────┘
```

**Split toggle**: Visual ↔ Payload. Both live-sync in real time.
- Edit YAML → canvas re-renders immediately
- Move element → YAML updates in Monaco

### 12.2 Selection & Transform

```
Click              → select layer, show handles
Shift+click        → multi-select
Drag marquee       → box select overlapping layers
Double-click       → enter group / enter text edit
Escape             → deselect / exit group

Handles:
  corners           → resize (Shift = maintain aspect)
  edge midpoints    → resize one axis
  rotation handle   → rotate (Shift = snap 15°)

Transform origin: center (Alt = opposite corner)
```

### 12.3 Keyboard Shortcuts

| Key | Action |
|---|---|
| V | select tool |
| T | text tool |
| R | rectangle tool |
| C | circle tool |
| L | line tool |
| G | toggle grid |
| / | command palette |
| Cmd+Z / Cmd+Shift+Z | undo / redo |
| Cmd+C / Cmd+V | copy / paste (YAML clipboard) |
| Cmd+D | duplicate layer |
| Cmd+G | group selected |
| Cmd+[ / Cmd+] | send back / bring forward |
| Cmd+0 | fit canvas to screen |
| Cmd+1 | 100% zoom |
| Cmd+E | export |
| Cmd+S | save |

### 12.4 Command Palette (/)

Search everything:
- `add step badge` → insert component
- `change accent color` → open theme override
- `export PDF` → trigger export
- `toggle grid` → show/hide grid
- `new page` → append page to carousel
- `open payload` → switch to Monaco mode
- `apply dark-tech theme` → switch theme

### 12.5 Layer Panel

```
Groups by z-band (collapsible):
  foreground   (z:70-89)
  overlay      (z:50-69)
  content      (z:20-49)   ← usually most populated
  structural   (z:10-19)
  background   (z:0-9)

Each row: [eye] [lock] [type icon] [name]   [z]
Right-click → rename, duplicate, delete, copy as YAML, paste style

Filter: search input at panel top
Virtual scroll: renders only visible rows → handles 200+ layers
Row height: fixed 32px, ~20-30 DOM nodes regardless of count
```

### 12.6 Properties Panel (Context-Aware)

```
rect:    position, fill, stroke, radius, shadow, effects, constraints
text:    content textarea, font/size/weight, color, alignment, spans
icon:    name, size, color
image:   src, fit, crop, alt_text
component: slot form fields, prop overrides
```

### 12.7 Alignment Tools

Available on multi-select:
- align left/center/right edge
- align top/center/bottom edge
- distribute horizontally / vertically (equal spacing)
- match width / match height

Smart guides: appear when dragging, snap to other layer edges/centers/canvas center/grid, show distance tooltip.

### 12.8 File Watcher

```
project.yaml         → refresh file tree
*.theme.yaml         → re-resolve all tokens, re-render open designs
*.component.yaml     → re-render all designs using this component
*.design.yaml        → re-render that design if open
*.template.yaml      → refresh template preview
```

External edits in VS Code → live update in editor.
MCP tool calls → live update (append_page = instant new slide).

---

## 13. RENDERERS & EXPORT

### 13.1 Renderer Map

| Layer type | Renderer | Input | Output |
|---|---|---|---|
| rect, circle, line, polygon, path | Native SVG primitives | layer attrs | SVG |
| text (plain/rich) | Native SVG `<text>/<tspan>` | string | SVG |
| text (markdown) | marked.js | Markdown string | HTML |
| mermaid | mermaid.js | DSL string | SVG |
| chart | vega-lite | JSON spec | SVG |
| math | KaTeX | LaTeX string | HTML |
| code | Prism.js | code + language | HTML |
| icon | Lucide SVG sprite | icon name | SVG |
| image | Native SVG `<image>` | src path/base64 | SVG |
| effects | SVG filters | filter spec | SVG `<filter>` |

### 13.2 Render Cost Budget

```
rect/circle/line/polygon:  ~0.1ms   pure SVG, zero JS
text (plain):              ~0.3ms   SVG text + font metrics
text (markdown):           ~2ms     marked.js parse
icon:                      ~0.2ms   sprite lookup + SVG clone
image:                     ~5ms     decode + embed
mermaid:                   ~50ms    first render; cache SVG after
vega-lite chart:           ~30ms    first render; cache SVG after
katex math:                ~5ms     first render; cache after
code block (prism):        ~3ms     tokenize + render
```

Mermaid and vega-lite: **always cache**. Re-render only when content changes. Cached = ~0.1ms.

### 13.3 Lazy Renderer Loading

```
Initial bundle (~500KB gzipped):
  SVG primitives, text, icon, marked.js, token resolver

Lazy loaded on first encounter:
  mermaid         → import('mermaid')          when type: mermaid
  vega-lite       → import('vega-lite')        when type: chart
  katex           → import('katex')            when type: math
  prism.js        → import('prismjs')          when type: code
  dom-to-image    → import('dom-to-image-more') on export trigger
  jsPDF           → import('jspdf')            on PDF export
```

### 13.4 SVG Filter Map

```
feTurbulence        → noise texture, grain, paper feel
feDisplacementMap   → wave/liquid distortion on any layer
feColorMatrix       → duotone, sepia, hue rotate, desaturate
feGaussianBlur      → soft glow, depth of field
feComposite         → complex masking
feMorphology        → erode/dilate (stroke swell effect)
feBlend             → blend mode between two layers
feDropShadow        → shorthand drop shadow
```

All SVG filters: GPU-accelerated, resolution-independent, export as SVG.

### 13.5 Font Loading Strategy

```
1. On project open: read assets.fonts from project.yaml
2. Load via FontFace API:
   const font = new FontFace('Inter', 'url(assets/fonts/Inter-Variable.woff2)')
   await font.load()
   document.fonts.add(font)
3. Wait for document.fonts.ready before first render
   → prevents layout shift on initial render
4. Export: embed fonts as base64 in exported HTML/SVG
   → guarantees font parity between editor and export
```

### 13.6 Export Targets

| Format | Method | Quality |
|---|---|---|
| PNG ×1/×2/×3 | dom-to-image-more | Good |
| JPEG | dom-to-image-more | Good |
| SVG | Serialize DOM SVG | Perfect |
| HTML (self-contained) | Inline all assets | Perfect |
| PDF (Phase 1) | jsPDF + dom-to-image | Acceptable |
| PDF (Phase 2) | Puppeteer headless Chrome | Excellent |

**Rule: editor and exporter use the exact same SVG render pipeline. Never render differently for export.**

### 13.7 Self-Contained HTML Export

Single file contains:
- All fonts as base64 WOFF2
- All images as base64 data URIs
- All icon SVGs inline
- Full design YAML in `<script type="application/yaml">`
- Renders itself when opened in any browser

One HTML file = design + data + renderer.

---

## 14. ANIMATION SCHEMA (Phase 3 — define now, implement later)

### 14.1 Why Current Architecture Is Animation-Ready

Every layer property is:
- Discretely typed (color/number/string — not string blobs)
- Individually addressable by path
- Tokenized (resolves to concrete values)

Animation = property values that change over time. No structural changes needed — just add the time axis.

### 14.2 Animation Schema

```yaml
# Entrance / Exit (CSS animations)
animation:
  enter: { type: fade_up, delay: 0, duration: 600, easing: ease-out }
  exit: { type: fade_down, duration: 300 }

# Loop (CSS animations)
animation:
  loop: { type: float, duration: 3000, amplitude: 8 }
  loop: { type: pulse, scale: 1.02, duration: 1500 }
  loop: { type: glow, color: $primary, duration: 2000 }

# Keyframe timeline (full motion graphics)
keyframes:
  - t: 0
    x: 540
    y: 540
    opacity: 1.0
    fill.color: "$primary"
  - t: 1000
    x: 540
    y: 300
    opacity: 0.6
  - t: 2000
    x: 540
    y: 540
    opacity: 1.0

playback:
  duration: 2000
  loop: true
  easing: ease-in-out

# Stagger sequence (engine calculates delays)
sequence:
  stagger: 150
  items:
    - ref: step_1
      animate: fade_up
    - ref: step_2
      animate: fade_up
    - ref: step_3
      animate: fade_up
```

### 14.3 Enter/Exit Types (Implemented: css-generator.ts)

```
Enter: fade_up, fade_down, fade_left, fade_right,
       zoom_in, zoom_out, flip_x, flip_y,
       slide_up, slide_down, blur_in, bounce_in,
       rotate_in, elastic_in   (14 total)

Exit:  fade_out, zoom_out_exit, slide_up_exit,
       slide_down_exit, blur_out, flip_out, rotate_out  (7 total)

Loop:  float, pulse, glow, spin, shake, bounce, breathe  (7 total)
```

### 14.4 The One Rule That Enables Phase 3

**Never use style string blobs. Always use discrete typed properties.**

```yaml
# WRONG — blocks animation forever:
misc_styles: "color:#fff;opacity:0.5;transform:rotate(45deg)"

# RIGHT — fully animatable:
color: "#FFFFFF"
opacity: 0.5
rotation: 45
```

This rule must be enforced in Phase 1. Retrofitting means rewriting the schema.

---

## 15. INTERACTIVE HTML OUTPUT

### 15.1 Two Output Modes

| Mode | Description | Phase |
|---|---|---|
| A — Presentation | Design-first, navigational/decorative interactions, CSS/JS only | Phase 1 |
| B — Interactive Document | Design + behavior, buttons/state/data binding, TypeScript scripts | Phase 2+ |

### 15.2 Mode A — Interaction Schema

```yaml
- id: next_button
  type: rect
  z: 80
  interaction:
    on_click:
      action: next_page        # next_page | prev_page | goto_page | open_url
    on_hover:
      scale: 1.03
      shadow: $shadow_glow
      transition: 200ms ease
    cursor: pointer
```

Built-in actions (cover 80% of cases):
`next_page`, `prev_page`, `goto_page(id)`, `toggle_state(key)`, `set_state(key, val)`, `open_url(url)`, `copy_text(val)`, `reset_state`

### 15.3 Mode B — State + Scripts

```yaml
_output_mode: interactive

state:
  currentStep: { type: number, default: 0 }
  userName: { type: string, default: "" }
  showDetails: { type: boolean, default: false }

scripts:
  - id: on_next_click
    language: typescript
    code: |
      state.currentStep = Math.min(
        state.currentStep + 1,
        data.steps.length - 1
      )
```

Dynamic layer attributes:
```yaml
- id: step_label
  content:
    type: expression
    value: "`Step ${state.currentStep + 1}`"

- id: progress_bar
  width:
    type: expression
    value: "(state.currentStep / data.steps.length) * 920"
```

### 15.4 Script Sandbox

Scripts run in sandboxed iframe. Context available:
- `state` — design state (read/write)
- `data` — data bindings (read/write)
- `event` — triggering event (read only)
- `pages` — page navigation API
- `utils` — safe utility functions

Explicitly NOT available: `window`, `document`, `fetch`, `eval`, `require`

State management runtime: **custom 2KB, no framework**.
`setState(k,v)` → re-evaluate expressions → patch DOM.

---

## 16. BUILT-IN COMPONENT LIBRARY

Phase 1 target: ~55 components. All SVG. All JSON-configurable. No image generation.

```
Background styles (12):
  solid-bg, linear-gradient-bg, radial-gradient-bg,
  multi-gradient-bg, noise-texture-bg, glass-bg

Text block types (8):
  display-headline, section-heading, subheading,
  body-text, caption, inline-label, quote-block, code-inline

Shape primitives (12):
  rect, circle, line, arrow-line, filled-arrow,
  chevron, speech-bubble, badge-pill, tag-label,
  star, hexagon, triangle

Layout frames (6):
  card, callout-box, section-divider,
  step-row, table-row, icon-text-row

Decorative elements (8):
  line-accent, corner-bracket, dot-grid,
  diagonal-lines, noise-overlay, glow-spot,
  color-wash, border-gradient

Data components (5):
  bar-chart (vega-lite), donut-chart (vega-lite),
  progress-bar, icon-array, comparison-table

Diagram components (4):
  flowchart (mermaid), sequence-diagram (mermaid),
  timeline (mermaid), mindmap (mermaid)
```

---

## 17. KNOWN RISKS

| Risk | Mitigation |
|---|---|
| Font loading race condition | Wait for `document.fonts.ready` before any render |
| Export ≠ editor visual parity | Same SVG pipeline for both; no separate export renderer |
| YAML indentation errors from LLM | Validate on parse; Monaco shows inline errors; never silent fail |
| Layer ID collisions | Enforce unique IDs on save; auto-suffix on conflict |
| Z-index conflicts | Enforce uniqueness per page scope on save |
| Emoji/special chars in YAML | js-yaml full Unicode mode; test emoji in all text fields |
| Local LLM context exhaustion | Incremental tool calls; context compression; slots-only mode |
| Coordinate system drift | Lock unit=px, origin=top-left, no auto-sizing in JSON |
| Style string blobs (blocks animation) | Schema validation rejects non-typed style objects |
| Component circular dependency | Validate on save; detect cycles in dependency graph |
| Math.random() in render path | Seed any noise with layer.id (determinism rule) |
| Date.now() in render path | Prohibited; breaks determinism |

---

## 18. DESIGN DECISIONS LOG

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Render target | SVG-in-HTML | Canvas API, WebGL | Vector-native, exportable, CSS-compatible |
| Canvas library | None (vanilla TS) | Fabric.js, Konva.js | Full control, no library fighting SVG export |
| Source format | YAML | JSON, TOML | Comments, readability, LLM-friendly multiline |
| Runtime format | JSON | YAML | Fast parse, engine operates on objects |
| Framework | Vanilla TS | React, Vue, Svelte | Own render loop, no VDOM overhead |
| Icon library | Lucide | FontAwesome, Material | MIT, consistent style, SVG-native |
| Editor widget | Monaco | CodeMirror, Ace | VS Code engine, best YAML support |
| Drag library | interact.js | Custom, Hammer.js | Lightweight, MIT, handles resize+rotate |
| Z-index system | Banded (0-9,10-19...) | Sequential | Safe insertion without renumbering |
| Token syntax | `$token_name` | `{{token}}`, `var(--token)` | Short, unambiguous, LLM-natural |
| Component props | `{{prop_name}}` | `$prop`, `{prop}` | Distinct from theme tokens, readable |
| MCP transport | stdio | HTTP/SSE | Local-only, no port conflicts |
| PDF export P1 | jsPDF+dom-to-image | Puppeteer | Client-side, no server needed |
| PDF export P2 | Puppeteer | WeasyPrint, wkhtmltopdf | Pixel-perfect, same Chrome as preview |
| Bundle size target | <500KB initial | No limit | Forces lazy loading discipline |
| Render strategy | Dirty tracking per layer | Full redraw | 60fps drag performance |
| Heavy renderer loading | Lazy on first use | Always bundled | Keeps cold start <1s |
| Offline requirement | Hard constraint | Nice to have | Core philosophy, not optional |
| Deterministic render | Hard constraint | Best effort | Enables CI/CD, version control |
| Error handling | Visible always (Problems panel) | Console only | Silent failures are unacceptable |
| Interactive output | Two modes (A+B) | One mode | Mode A simpler, Mode B powerful |
| Scripting language | TypeScript/JS | Custom formula | Familiar, LLM-friendly, standard |
| Script sandbox | iframe/SES sandbox | None | Security without custom parser |
| State management | Custom 2KB runtime | React/Vue/Svelte | No framework, minimal overhead |

---

## 19. ROADMAP

### Phase 1 — Editor + Engine

```
Week 1:  schema + token resolver (95% coverage), rect/circle/text/icon renderer
Week 2:  all fill types, all text subtypes, SVG filters, visual regression baselines
Week 3:  Monaco editor, bidirectional live sync, Problems panel
Week 4:  interact.js: select, drag, resize, rotate, multi-select, undo/redo
Week 5:  snap to grid, snap to layer, Playwright E2E for interactions
Week 6:  layer panel (virtual scroll), properties panel, gradient editor, alignment tools
Week 7:  component system (ref, slots, overrides), template system, component registry
Week 8:  export: PNG, SVG, self-contained HTML, PDF; project file system; file watcher
Week 9:  command palette, keyboard shortcuts, carousel editor, touch/pointer events
Week 10: release pipeline, coverage reporting, perf benchmarks, bundle size gate, v1.0.0
```

### Phase 2 — MCP Server

```
- MCP stdio server scaffold (Node.js + TypeScript)
- Semantic shorthand parser (L1/L2 → L3 expansion)
- Full tool surface (16+ tools, see ARCHITECTURE.md §6)
- Incremental generation protocol (create → append → seal → export)
- Puppeteer integration (high-fidelity PDF export)
- Context compression for local LLM
- Batch generation (batch_create tool)
- Resume protocol (recover from crashed generation)
```

### Phase 3 — Animation

```
- CSS entrance/exit animation system
- Stagger sequence engine
- Animated HTML export
- Keyframe timeline editor panel
- Full keyframe animation engine
- GIF/MP4/WebM export (Puppeteer frame capture + FFmpeg)
- Lottie JSON export
- motion document type in project.yaml
```

---

*DESIGN.md v2.0.0 — Recovered from CLAUDE.md v1.2.0 + codebase audit April 2026*
