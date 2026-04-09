# CLAUDE.md — Graphic Design Engine Project
# Visual Design Payload System with LLM-First Architecture
# Version: 1.0.0 | Status: Planning → Phase 1 Active

---

## 1. PROJECT OVERVIEW

### 1.1 What This Is

A **local-first, file-based graphic design engine** where:
- Designs are stored as human-readable YAML payload files
- A browser-based editor renders and manipulates those files visually
- An LLM generates or modifies designs via structured semantic shorthand
- An MCP server exposes the engine as tools for AI agent workflows
- Everything runs locally — no cloud APIs, no subscriptions, no internet after install

### 1.2 Core Philosophy

```
LLM = intent generator (writes semantic shorthand YAML)
Engine = spec compiler (expands shorthand → full render tree)
Editor = visual spec editor (GUI over the YAML)
Disk = verbose spec store (.design.yaml files)
MCP = tool surface (LLM ↔ engine bridge)
```

The design file IS the product. The HTML canvas is just a view.
The LLM and the human editor are both just YAML writers.

### 1.3 Inspired By

| Inspiration | What We Borrow |
|---|---|
| Canva | JSON-backed design engine, template + slot pattern |
| Power Apps | YAML as app/project source of truth, project manifest |
| Figma | Layer panel, property inspector, component system |
| Penpot | Open file format, self-hostable, SVG-native |
| Obsidian | Local-first folder-as-project, plain text everything |
| Reveal.js | Single HTML file = complete self-rendering document |
| draw.io | File opens in browser = rendered; same file in editor = editable |
| Typst | Markup language → beautiful output via clean AST |
| VS Code | Monaco editor, command palette, file watcher |
| Vega-Lite | Declarative JSON spec → chart, same philosophy as design JSON |

### 1.4 What This Is NOT

- Not a Photoshop replacement (no pixel-level editing, no heavy raster)
- Not a Canva clone (no cloud, no AI image generation per page)
- Not a web app builder (output is design files, not interactive apps)
- Not a real-time multiplayer tool (single user, local file system)

### 1.5 Primary Use Cases

1. **How-to posters** — structured content, fixed template, LLM fills slots
2. **Single-page posters** — custom layout, LLM generates full layer spec
3. **Carousel / slide decks** — paged content, incremental page generation
4. **Technical diagrams** — Mermaid + shape layers + data viz combined
5. **Batch design generation** — same template × N content variations

---

## 2. DEVELOPMENT PHASES

```
Phase 1 (CURRENT FOCUS): Editor + Engine
  ├── JSON/YAML payload spec
  ├── SVG renderer (static)
  ├── Monaco payload editor (split view)
  ├── Canvas interactions (select, drag, resize)
  ├── Export pipeline (PNG, PDF)
  └── Project file system (multi-file project)

Phase 2: MCP Integration
  ├── MCP server (stdio transport, local only)
  ├── Semantic shorthand parser
  ├── Tool surface (create, append, patch, export)
  ├── Incremental page generation protocol
  └── Batch design generation

Phase 3: Animation (Future)
  ├── CSS entrance/exit animations
  ├── Keyframe timeline
  ├── Animated HTML export
  ├── GIF / MP4 / Lottie export
  └── Timeline editor UI panel
```

---

## 3. TECH STACK

### 3.1 Frontend (Editor + Engine)

```
Core:
  Vite + TypeScript          — fast dev, clean build, no framework overhead
  Vanilla TS (no React/Vue)  — own the render loop, no VDOM fighting SVG
  CSS custom properties       — design token system baked into engine

Canvas / Render Layer:
  SVG-in-HTML                — primary render target, vector native
  No Fabric.js / Konva.js    — too heavy, fight SVG export
  interact.js                — drag, resize, rotate (lightweight, MIT)

Embedded Renderers:
  marked.js                  — Markdown → HTML (text content)
  mermaid                    — DSL → SVG (diagrams, flowcharts)
  vega-lite                  — JSON spec → SVG (charts, data viz)
  katex                      — LaTeX → HTML (math expressions)
  prism.js                   — syntax highlighting (code blocks)
  lucide (SVG sprite)        — icon library, consistent style, MIT

Editor UI:
  Monaco Editor              — JSON/YAML payload editing (VS Code engine)
  Floating UI                — tooltips, popovers, context menus
  js-yaml                    — YAML parse/serialize (full Unicode support)

Export:
  dom-to-image-more          — PNG/JPEG client-side export
  jsPDF                      — PDF client-side (basic)
  Puppeteer (MCP server)     — PDF high-fidelity, frame capture (Phase 2+)

Font Loading:
  fontsource                 — self-hosted Google Fonts (npm packages)
  Variable fonts preferred   — 1 file = infinite weight/width variants
```

### 3.2 Backend / MCP Server (Phase 2)

```
Runtime:    Node.js + TypeScript
Protocol:   MCP stdio transport (local only)
Storage:    flat files (.design.yaml, .theme.yaml, etc.)
PDF:        Puppeteer (headless Chrome, local)
No DB:      everything lives in payload files
No cloud:   no external API calls at runtime
```

### 3.3 File Format Decision

```
Source format:   YAML (.design.yaml)  — human/LLM readable, supports comments
Runtime format:  JSON (in memory)     — fast parse, engine operates on this
Export format:   YAML                 — serialize back from JSON on save

Reason YAML wins over JSON:
  ✓ Comments (LLM can annotate its own output)
  ✓ Cleaner multiline strings (text content)
  ✓ Less punctuation noise for nested structures
  ✓ Git diff friendly
  ✗ Indentation errors (mitigated: validate on parse, Monaco shows errors)
```

---

## 4. PROJECT FILE STRUCTURE

### 4.1 Project Folder Layout

```
my-project/
├── project.yaml                        ← project manifest (entry point)
├── .designignore                       ← exclude from file watcher
│
├── themes/
│   ├── dark-tech.theme.yaml
│   └── light-clean.theme.yaml
│
├── components/
│   ├── index.yaml                      ← component registry
│   ├── step-badge.component.yaml
│   ├── code-block.component.yaml
│   └── hero-card.component.yaml
│
├── templates/
│   ├── index.yaml                      ← template registry
│   ├── how-to-poster.template.yaml
│   ├── carousel-cover.template.yaml
│   └── step-page.template.yaml
│
├── designs/
│   ├── mcp-setup-carousel.design.yaml
│   └── concepts-poster.design.yaml
│
├── assets/
│   ├── fonts/
│   │   └── Inter-Variable.woff2
│   ├── icons/
│   │   └── custom-logo.svg
│   └── images/
│       └── diagram-base.png
│
└── exports/
    ├── mcp-setup-carousel.pdf
    └── concepts-poster.png
```

### 4.2 File Type Summary

| File | Protocol | Purpose |
|---|---|---|
| `project.yaml` | `project/v1` | Manifest, registry, config |
| `*.theme.yaml` | `theme/v1` | Design tokens (colors, fonts, spacing) |
| `*.component.yaml` | `component/v1` | Reusable layer group with exposed props |
| `*.template.yaml` | `template/v1` | Full canvas with named slot definitions |
| `*.design.yaml` | `design/v1` | Actual design content and layer tree |

---

## 5. PAYLOAD FILE SPECIFICATIONS

### 5.1 project.yaml

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
    type: carousel
    pages: 10
    status: draft
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

### 5.2 *.theme.yaml

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

### 5.3 *.design.yaml (single poster)

```yaml
_protocol: "design/v1"
_mode: complete

meta:
  id: "uuid"
  name: "MCP Concepts Poster"
  type: poster
  created: "2026-04-09"
  modified: "2026-04-09"
  generator: "human"
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
    primary: "#3D9EE4"

# Single page: layers at top level
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

### 5.4 *.design.yaml (carousel / paged)

```yaml
_protocol: "design/v1"
_mode: in_progress

meta:
  id: "uuid"
  name: "MCP Setup Guide"
  type: carousel
  generation:
    status: in_progress
    total_pages: 10
    completed_pages: 4

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
    template_ref: carousel-cover
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
```

---

## 6. LAYER SCHEMA REFERENCE

### 6.1 Z-Index Bands

```
background:   0–9    bg colors, textures, full-bleed shapes
structural:  10–19   layout shapes, cards, containers
content:     20–49   text, icons, images, charts, diagrams
overlay:     50–69   decorative overlays, color washes
foreground:  70–89   accent shapes, highlights
ui:          90–99   EDITOR ONLY — selection handles, guides
```

Rule: never use sequential z (1,2,3...). Use banded for safe layer insertion.
Rule: all z values must be unique per page scope.

### 6.2 Layer Types

| type | description | key attributes |
|---|---|---|
| rect | rectangle | x,y,w,h, fill, stroke, radius |
| circle | circle/ellipse | cx,cy,rx,ry, fill, stroke |
| path | SVG bezier path | d (SVG path string), fill, stroke |
| polygon | n-sided shape | points or named shape, fill, stroke |
| line | straight line | x1,y1,x2,y2, stroke |
| text | text block | content{type,value}, style, spans |
| image | raster/SVG file | src, fit, crop |
| icon | lucide icon name | name, size, color |
| component | component instance | ref, slots, overrides |
| component_list | repeated component | component_ref, items[], gap |
| mermaid | mermaid DSL | definition (string) |
| chart | vega-lite spec | spec (JSON object) |
| code | code block | language, code, theme |
| math | KaTeX expression | expression (LaTeX string) |
| group | layer group | layers[] (children) |

### 6.3 Fill Types Summary

```yaml
fill: { type: solid, color: "$primary", opacity: 1.0 }
fill: { type: linear, angle: 135, stops: [{color,position},...] }
fill: { type: radial, cx: 50, cy: 50, radius: 70, stops: [...] }
fill: { type: conic, cx: 50, cy: 50, stops: [...] }
fill: { type: multi, layers: [{type,opacity,stops},...] }
fill: { type: none }
```

Gradient stops always: `{ color: hex_or_token, position: 0-100 }`
Noise overlay: add to multi layers — `{ type: noise, opacity: 0.03, frequency: 0.65, octaves: 4 }`

### 6.4 Token Reference Syntax

```yaml
# Reference a theme token anywhere a value is expected:
color: "$primary"           # resolves to theme.colors.primary
font_family: "$heading"     # resolves to theme.typography.families.heading
shadow: "$shadow_card"      # resolves to theme.effects.shadow_card

# Reference a component prop inside component definition:
color: "{{accent}}"         # resolves from component props at render time
content: "{{label}}"

# Reference project asset:
src: "$project.assets.images.diagram-base"
```

### 6.5 Position Shorthand Options

```yaml
# Explicit (always valid)
x: 80
y: 200
width: 920
height: 480

# Array shorthand [x, y, w, h]
pos: [80, 200, 920, 480]

# Grid-relative (engine calculates px)
pos:
  mode: grid
  col_start: 1
  col_span: 12
  row_start: 3
  baseline_offset: 4

# Auto height (text expands)
height: auto
```

---

## 7. MUTATION PROTOCOL (INCREMENTAL GENERATION)

The file protocol supports four operations to allow incremental LLM generation without token exhaustion.

### 7.1 Operations

```yaml
# CREATE — initialize new document (once per design)
_operation: create
_target: ./designs/mcp-guide.design.yaml
# ... full scaffold content

# APPEND — add pages or layers to existing document
_operation: append
_target: ./designs/mcp-guide.design.yaml
_append_to: pages          # dot-path to array field
# ... array items to append

# PATCH — surgical update to specific field by selector
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

### 7.2 Incremental Carousel Generation Flow

```
Tool Call 1:  create_design
              scaffold + theme + pages: []
              ~80–120 tokens output

Tool Call 2:  append_page (cover)
              slots only: title, subtitle, accent
              ~100–150 tokens output

Tool Call 3–N: append_page × N (one per content page)
              ~60–100 tokens each

Tool Call N+1: seal_design
              set _mode: complete, generation.status: complete
              ~20 tokens

Tool Call N+2: export_design
              trigger PNG or PDF export
              0 tokens output

──────────────────────────────────────
Total tokens for 10-page carousel:
  ~900–1500 tokens output total
  Fits within local LLM 8K output limit
  Each individual call fits within 2K output
```

### 7.3 Token Budget Per Abstraction Level

```
Level 1 — Slot Fill (LLM writes this):
  template + slots only
  ~50–150 tokens per design
  Used for: template-based designs, batch generation

Level 2 — Semantic Shorthand (LLM writes this):
  layer types + token refs + pos shorthand
  ~300–600 tokens per design
  Used for: custom single-page designs

Level 3 — Full Verbose YAML (engine writes, human edits):
  all attributes explicit, comments included
  ~2000–4000 tokens per design
  NEVER generated by LLM directly
  Lives on disk, visible in Monaco editor
```

### 7.4 Resumable Generation

Generation state is tracked in meta:
```yaml
meta:
  generation:
    status: in_progress
    total_pages: 10
    completed_pages: 4       # resume from page 5
    last_operation: append_page
```

MCP tool `resume_design(design_id)` reads this and continues from last completed page. If LLM crashes mid-generation, partial file is still valid and openable.

### 7.5 Layer ID Stability Rules

- IDs must be **stable and semantic**, not auto-incremented integers
- Same semantic element across regenerations must keep same ID
- `id: headline` always means the headline element
- IDs are scoped per page (same id in different pages is valid)
- If LLM regenerates a design, stable IDs make YAML diff readable:

```diff
  - id: headline
-   content: "5 Ways to Optimize Your API"
+   content: "7 Ways to Optimize Your MCP Server"
```

---

## 8. EDITOR SPECIFICATION

### 8.1 Canvas UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Project: MCP Guide        [theme] [zoom] [export]   │
├──────────────┬──────────────────────────────┬───────────────┤
│              │                              │               │
│  FILE TREE   │       CANVAS AREA            │  PROPERTIES   │
│              │   (centered, shadowed        │  PANEL        │
│  ▼ Designs   │    fixed aspect ratio)       │               │
│    📄 poster │                              │  Context-     │
│    📄 slide  │   click → select element     │  aware:       │
│  ▼ Templates │   drag → move                │  shows fields │
│    📄 how-to │   handles → resize           │  for selected │
│  ▼ Components│   dbl-click → edit text      │  layer type   │
│    🧩 badge  │                              │               │
│  ▼ Themes    │                              │  [+ Add Layer]│
│    🎨 dark   │                              │               │
├──────────────┴──────────────────────────────┴───────────────┤
│  LAYER PANEL (collapsible bottom or left sidebar)           │
│  ▼ content (z:20-49)  ▼ structural (z:10-19)  bg (z:0)     │
├─────────────────────────────────────────────────────────────┤
│  [VISUAL MODE]  [PAYLOAD MODE]   ← toggle switch            │
│  Payload mode: Monaco editor, live sync with canvas         │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 The Split Toggle (Key Differentiator)

One-click toggle between two modes:
- **Visual mode** — WYSIWYG canvas, drag/resize/click
- **Payload mode** — raw YAML in Monaco editor

Both are **live bidirectional**:
- Edit YAML → canvas re-renders immediately
- Move element in canvas → YAML updates in Monaco

This exposes the file format transparently — no other design tool does this.

### 8.3 Selection & Transform

```
Click              → select layer, show handles
Shift+click        → add to selection (multi-select)
Drag marquee       → box select all overlapping layers
Double-click       → enter group / enter text edit mode
Escape             → deselect / exit group

Handles:
  corners           → resize (maintain aspect with Shift)
  edge midpoints    → resize one axis
  rotation handle   → rotate (snap to 15° with Shift)
  
Transform origin:
  default = center
  hold Alt → transform from opposite corner
```

### 8.4 Keyboard Shortcuts

```
V          select tool
T          text tool
R          rectangle tool
C          circle tool
L          line tool
G          toggle grid
/          command palette
Cmd+Z      undo
Cmd+Shift+Z redo
Cmd+C      copy (puts YAML in clipboard)
Cmd+V      paste (parses YAML from clipboard)
Cmd+D      duplicate layer
Cmd+G      group selected layers
Cmd+[      send backward
Cmd+]      bring forward
Cmd+0      fit canvas to screen
Cmd+1      100% zoom
Cmd+E      export current design
Cmd+S      save
```

### 8.5 Command Palette

Accessible via `/` — search everything:
- "add step badge" → insert component
- "change accent color" → open theme override
- "export PDF" → trigger export
- "toggle grid" → show/hide grid
- "new page" → append page to carousel
- "open payload" → switch to Monaco mode
- "apply dark-tech theme" → switch theme

### 8.6 Alignment Tools

```
Align toolbar (visible on multi-select):
  align left edge
  align horizontal center
  align right edge
  align top edge
  align vertical center
  align bottom edge
  distribute horizontally (equal spacing)
  distribute vertically (equal spacing)
  match width
  match height

Smart guides:
  appear when dragging
  snap to: other layer edges, layer centers, canvas center, grid
  show distance tooltip
```

### 8.7 Layer Panel

```
Groups by z-band (collapsible):
  foreground   (z:70-89)
  overlay      (z:50-69)
  content      (z:20-49)   ← usually most populated
  structural   (z:10-19)
  background   (z:0-9)

Each layer row:
  [eye icon] [lock icon] [type icon] [layer name]   [z value]

Right-click layer → context menu:
  Rename, Duplicate, Delete, Move to group,
  Lock/Unlock, Hide/Show, Copy as YAML, Paste style

Search layers by name (filter input at top of panel)
Virtual scroll (renders only visible rows — handles 200+ layers)
```

### 8.8 Properties Panel (Context-Aware)

Shows different fields based on selected layer type:

```
rect selected:
  Position: x, y, w, h, rotation
  Fill: color picker / gradient editor
  Stroke: color, width, dash
  Radius: tl, tr, br, bl (linked or independent)
  Shadow: list of shadows, add/remove
  Effects: blur, backdrop-blur, opacity, blend-mode
  Constraints: h/v resize behavior

text selected:
  Content: textarea (live edit)
  Font: family, size, weight, line-height, letter-spacing
  Color: fill type (solid or gradient)
  Alignment: h/v align, wrap mode
  Spans: inline style ranges

component selected:
  Slots: form fields per slot definition
  Overrides: prop overrides
  (internal layers not directly editable)
```

### 8.9 File Watcher

Editor watches the entire project folder:
```
File changed on disk:
  project.yaml         → refresh file tree
  *.theme.yaml         → re-resolve all tokens, re-render open designs
  *.component.yaml     → re-render all designs using this component
  *.design.yaml        → re-render that design if open
  *.template.yaml      → refresh template preview

This enables:
  External YAML edits in VS Code → live update in editor
  MCP tool calls → live update in editor (append_page = instant new slide)
```

---

## 9. EMBEDDED RENDERERS

Each renderer handles a specific layer type. The engine routes to the correct renderer based on `type`.

### 9.1 Renderer Map

| Layer type | Renderer | Input | Output |
|---|---|---|---|
| text (plain/rich) | Native SVG `<text>/<tspan>` | string | SVG |
| text (markdown) | marked.js | Markdown string | HTML |
| mermaid | mermaid.js | DSL string | SVG |
| chart | vega-lite | JSON spec | SVG |
| math | KaTeX | LaTeX string | HTML |
| code | Prism.js | code + language | HTML |
| icon | Lucide SVG sprite | icon name | SVG |
| image | Native SVG `<image>` | src path/base64 | SVG |
| shape/rect/circle | Native SVG primitives | layer attrs | SVG |
| effects | SVG filters | filter spec | SVG `<filter>` |

### 9.2 SVG Filter Map

```
feTurbulence        → noise texture, grain, paper feel
feDisplacementMap   → wave/liquid distortion on any layer
feColorMatrix       → duotone, sepia, hue rotate, desaturate
feGaussianBlur      → soft glow, depth of field
feComposite         → complex masking operations
feMorphology        → erode/dilate (stroke swell effect)
feBlend             → blend mode between two layers
feDropShadow        → shorthand for drop shadow
```

All SVG filters are GPU-accelerated, resolution-independent, output as SVG.

### 9.3 Font Loading Strategy

```
1. On project open: read assets.fonts from project.yaml
2. Load all fonts via FontFace API:
   const font = new FontFace('Inter', 'url(assets/fonts/Inter-Variable.woff2)')
   await font.load()
   document.fonts.add(font)
3. Wait for document.fonts.ready before first render
   → prevents layout shift on initial render
4. For export: embed fonts as base64 in exported HTML/SVG
   → guarantees font parity between editor and export
```

### 9.4 Icon System

```
Use Lucide icon library (MIT, ~1400 icons, consistent style)
Reference by name in layer: { type: icon, name: "download", size: 24, color: "$primary" }
Engine resolves name → SVG path data from local sprite
No network request — icons bundled at build time

Fallback for custom icons:
  Place .svg file in assets/icons/
  Reference as: { type: icon, name: "custom:my-logo" }
```

---

## 10. EXPORT PIPELINE

### 10.1 Export Targets

| Format | Method | Quality | Notes |
|---|---|---|---|
| PNG | dom-to-image-more | Good | Client-side, scale factor support |
| JPEG | dom-to-image-more | Good | Smaller file, no transparency |
| PDF | jsPDF + dom-to-image | Acceptable | Client-side, basic fidelity |
| PDF (high) | Puppeteer (Phase 2) | Excellent | Headless Chrome, pixel-perfect |
| SVG | Serialize DOM SVG | Perfect | Vector, no Puppeteer needed |
| HTML | Inline all assets | Perfect | Self-contained, opens in browser |

### 10.2 Export Scale Factors

```
Screen preview:   ×1   (1080×1080 px display)
PNG standard:     ×2   (2160×2160 px — retina)
PNG print-ready:  ×3   (3240×3240 px — 300dpi at ~10.8in)
PDF A4:           calculate from mm → px at 96dpi, then scale
```

### 10.3 Self-Contained HTML Export

The HTML export is a single file that:
- Contains all fonts as base64 WOFF2
- Contains all images as base64 data URIs
- Contains all icon SVGs inline
- Contains the full design YAML in a `<script type="application/yaml">` tag
- Renders itself when opened in any browser
- Is readable/editable in any text editor

This means: **one HTML file = the design + the data + the renderer.**

### 10.4 Export Consistency Rule

**The editor and exporter must use the exact same SVG render pipeline.**
Never render differently for export.
Font loading must complete before any export is triggered.
Canvas must be at 100% zoom before capture (scale factor applied after).

---

## 11. MCP SERVER SPECIFICATION (Phase 2)

### 11.1 Server Philosophy

```
Transport:    stdio (local only, no HTTP server)
No cloud:     zero external API calls at runtime
No OAuth:     no authentication required
Storage:      reads/writes .design.yaml files directly
Puppeteer:    local headless Chrome for PDF export
```

### 11.2 Full Tool Surface

```typescript
// ── PROJECT ─────────────────────────────────────────────────
create_project(name: string, theme?: string, canvas?: string)
  → creates project folder + project.yaml + default theme
  → returns: project_id, path

open_project(path: string)
  → validates project.yaml, loads registry
  → returns: project metadata, design list

list_designs(project_id: string)
  → returns: array of design metadata with status

// ── DESIGN LIFECYCLE ────────────────────────────────────────
create_design(project_id, template?, theme_override?, canvas?)
  → creates scaffold .design.yaml, registers in project.yaml
  → returns: design_id, path

append_page(design_id, template_ref?, slots?, layers?)
  → appends one page to pages[]
  → updates generation.completed_pages
  → returns: page_id, current page count

patch_design(design_id, selectors: [{path, value}])
  → surgical update to specific fields by dot-path selector
  → returns: patched field paths

seal_design(design_id)
  → sets _mode: complete, generation.status: complete
  → returns: design summary

duplicate_design(project_id, design_id, new_name)
  → copies file with new UUID
  → registers in project.yaml
  → returns: new design_id

// ── CONTENT MANIPULATION ────────────────────────────────────
update_slot(design_id, page_id, slot, value)
  → updates one slot value in a page
  → returns: updated slot

add_layer(design_id, page_id?, layer_spec)
  → adds layer to layers[] (poster) or page.layers[] (carousel)
  → validates z-index uniqueness, assigns if missing
  → returns: layer_id

update_layer(design_id, layer_id, props)
  → updates specific props on a layer
  → returns: updated layer

remove_layer(design_id, layer_id)
  → removes layer by id
  → returns: removed layer_id

reorder_layers(design_id, page_id?, order: string[])
  → reorders layers array by id list
  → returns: new order

// ── COMPONENT SYSTEM ────────────────────────────────────────
list_components(project_id)
  → returns: component index with descriptions and props

insert_component(design_id, component_ref, slots, pos, page_id?)
  → adds component instance as layer
  → returns: layer_id

save_as_component(design_id, layer_ids[], component_name)
  → extracts layers to new .component.yaml
  → replaces original layers with component instance
  → updates components/index.yaml
  → returns: component_id

// ── THEME ───────────────────────────────────────────────────
list_themes(project_id)
  → returns: available themes with token preview

apply_theme(project_id, theme_id, target?)
  → updates default_theme in project.yaml
  → re-resolves all token refs across all designs
  → returns: affected design count

// ── EXPORT ──────────────────────────────────────────────────
export_design(design_id, format, path?, scale?)
  → format: png | jpeg | pdf | svg | html
  → scale: 1 | 2 | 3 (default 2)
  → returns: output path, file size

export_page(design_id, page_id, format, path?)
  → exports single page from carousel
  → returns: output path

batch_export(design_ids[], format, output_folder)
  → exports multiple designs in one call
  → returns: output paths[]

// ── BATCH GENERATION ────────────────────────────────────────
batch_create(template_id, slots_array[], project_id)
  → generates N designs from 1 template
  → each item in slots_array = one design
  → returns: design_ids[], paths[]
```

### 11.3 Semantic Shorthand the LLM Uses

The MCP tools accept semantic shorthand. The server expands to full YAML before writing.

```yaml
# LLM passes this to append_page:
template_ref: step-page
slots:
  step_number: "03"
  step_title: "Configure the YAML file"
  step_body: "Edit mcp.config.yaml with your server settings"
  icon: settings
  accent: $primary

# Server expands to full page with all layer attributes resolved
# LLM never writes the verbose form
```

### 11.4 Context Compression for Local LLM

For local LLMs with tight context windows:
```
Each tool call gets a compressed context summary:
  "Design: mcp-guide carousel. Completed: [cover, intro, step-1, step-2].
   Next: step-3. Theme: dark-tech. Template: step-page.
   Slots required: step_number, step_title, step_body, icon, accent."

LLM responds with slots only (~50 tokens).
Server handles all file operations.
LLM never sees accumulated YAML.
```

---

## 12. ANIMATION EXTENSION (Phase 3)

### 12.1 Why Current Architecture Is Animation-Ready

Every layer property is already:
- Discretely typed (color, number, string — not string blobs)
- Individually addressable by path
- Tokenized (theme tokens resolve to values)

Animation = property values that change over time.
No structural changes needed — just add the time axis.

### 12.2 Animation Schema (Defined Now, Implemented Phase 3)

```yaml
# Entrance / Exit (Level 1 — CSS animations)
animation:
  enter: { type: fade_up, delay: 0, duration: 600, easing: ease-out }
  exit: { type: fade_down, duration: 300 }

# Loop (Level 1 — CSS animations)
animation:
  loop: { type: float, duration: 3000, amplitude: 8 }
  loop: { type: pulse, scale: 1.02, duration: 1500 }
  loop: { type: glow, color: $primary, duration: 2000 }

# Keyframe Timeline (Level 3 — full motion graphics)
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
    fill.color: "$secondary"
  - t: 2000
    x: 540
    y: 540
    opacity: 1.0
    fill.color: "$primary"

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

### 12.3 Phase 3 New Document Type

```yaml
# project.yaml addition
designs:
  - id: mcp-intro-motion
    path: designs/mcp-intro.design.yaml
    type: motion             # new type in Phase 3
    duration: 12000          # ms
    fps: 60
```

### 12.4 Phase 3 Export Targets

```
Animated HTML     — CSS/JS animation, self-contained
MP4 / WebM        — Puppeteer frame capture → FFmpeg
GIF               — same frame capture pipeline
Lottie JSON       — for mobile/web embeds, resolution-independent
APNG              — animated PNG
```

### 12.5 The One Rule That Enables Phase 3

**Never use style string blobs. Always use discrete typed properties.**

```yaml
# WRONG — blocks animation forever:
misc_styles: "color:#fff;opacity:0.5;transform:rotate(45deg)"

# RIGHT — fully animatable:
color: "#FFFFFF"
opacity: 0.5
rotation: 45
```

This rule must be enforced in Phase 1. Retrofitting it later means rewriting the schema.

---

## 13. DESIGN COMPONENT LIBRARY (Built-In)

### 13.1 Primitive Component Set (Phase 1 Target)

```
Background styles:
  solid-bg, linear-gradient-bg, radial-gradient-bg,
  multi-gradient-bg, noise-texture-bg, glass-bg (12)

Text block types:
  display-headline, section-heading, subheading,
  body-text, caption, inline-label, quote-block,
  code-inline (8)

Shape primitives:
  rect, circle, line, arrow-line, filled-arrow,
  chevron, speech-bubble, badge-pill, tag-label,
  star, hexagon, triangle (12)

Layout frames:
  card, callout-box, section-divider,
  step-row, table-row, icon-text-row (6)

Decorative elements:
  line-accent, corner-bracket, dot-grid,
  diagonal-lines, noise-overlay, glow-spot,
  color-wash, border-gradient (8)

Data components:
  bar-chart (vega-lite), donut-chart (vega-lite),
  progress-bar, icon-array, comparison-table (5)

Diagram components:
  flowchart (mermaid), sequence-diagram (mermaid),
  timeline (mermaid), mindmap (mermaid) (4)
```

**Total: ~55 components. All SVG. All JSON-configurable. No image generation.**

### 13.2 Typography Depth

```
Character level:  individual color, size, baseline-shift, letter-spacing
Span level:       bold, italic, color, gradient-fill, stroke+fill split
Block level:      line-height, paragraph-spacing, text-wrap-balance
Transform level:  rotate, skew, scale-x/y
Path text:        text follows SVG path (arc, wave, custom bezier)
Variable fonts:   weight, width, slant as continuous axes (1 file)
```

---

## 14. KNOWN RISKS AND MITIGATIONS

| Risk | Mitigation |
|---|---|
| Font loading race condition | Wait for `document.fonts.ready` before any render |
| Export ≠ editor visual parity | Same SVG pipeline for both; no separate export renderer |
| YAML indentation errors from LLM | Validate on parse; Monaco shows inline errors; never silent fail |
| Layer ID collisions | Enforce unique IDs on save; auto-suffix on conflict |
| Z-index conflicts | Enforce uniqueness per page scope on save |
| Emoji/special chars in YAML | Use js-yaml with full Unicode; test emoji in all text fields |
| Local LLM context exhaustion | Incremental tool calls; context compression; slots-only mode |
| Coordinate system drift across formats | Lock unit=px, origin=top-left, no auto sizing in JSON |
| Style string blobs (blocks animation) | Schema validation rejects non-typed style objects |
| Component ref circular dependency | Validate on component save; detect cycles in dependency graph |

---

## 15. BUILD ROADMAP

### Phase 1 — Editor + Engine (CURRENT)

```
Week 1–2:
  [ ] Lock JSON/YAML schema (all layer types, fill types, tokens)
  [ ] Lock coordinate and unit system
  [ ] Build static SVG renderer (JSON → SVG, no interactions)
  [ ] Prove 5 layer types render correctly

Week 3:
  [ ] Prove LLM generates valid semantic shorthand for 3 template types
  [ ] Build token resolution ($ → theme value)
  [ ] Build shorthand expander (pos array → x/y/w/h, etc.)

Week 4–5:
  [ ] Monaco editor integration (YAML mode, live validation)
  [ ] Visual/payload toggle (bidirectional live sync)
  [ ] interact.js: click-to-select, drag-to-move, handles-to-resize

Week 6:
  [ ] Layer panel (grouped by z-band, collapsible)
  [ ] Properties panel (context-aware per layer type)
  [ ] Alignment tools (align, distribute, match size)

Week 7:
  [ ] Export pipeline (PNG via dom-to-image, SVG serialize, HTML self-contained)
  [ ] Font loading strategy (preload, document.fonts.ready gate)
  [ ] Project file system (project.yaml, file tree panel)

Week 8:
  [ ] Component system (reference, slot resolution, prop overrides)
  [ ] Template system (slot definitions, locked layout)
  [ ] File watcher (live reload on external YAML edits)

Week 9–10:
  [ ] Multi-page carousel editor (page thumbnails, page navigation)
  [ ] Command palette
  [ ] Undo/redo history
  [ ] Polish, edge cases, cross-browser testing
```

### Phase 2 — MCP Server

```
  [ ] MCP stdio server scaffold (Node.js + TypeScript)
  [ ] Semantic shorthand parser
  [ ] Full tool surface (see Section 11.2)
  [ ] Incremental generation protocol (create → append → seal → export)
  [ ] Puppeteer integration (high-fidelity PDF export)
  [ ] Context compression for local LLM
  [ ] Batch generation (batch_create tool)
  [ ] Resume protocol (recover from crashed generation)
```

### Phase 3 — Animation

```
  [ ] CSS entrance/exit animation system
  [ ] Stagger sequence engine
  [ ] Scroll/trigger animation support
  [ ] Animated HTML export
  [ ] Keyframe timeline editor panel
  [ ] Full keyframe animation engine
  [ ] GIF export (Puppeteer frame capture)
  [ ] MP4/WebM export (FFmpeg pipeline)
  [ ] Lottie JSON export
  [ ] motion document type in project.yaml
```

---

## 16. DESIGN DECISIONS LOG

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Render target | SVG-in-HTML | Canvas API, WebGL | Vector-native, exportable, CSS-compatible |
| Canvas library | None (vanilla) | Fabric.js, Konva.js | Full control, no library fighting SVG export |
| Source format | YAML | JSON, TOML | Comments, readability, LLM-friendly multiline |
| Runtime format | JSON | YAML | Fast parse, engine operates on objects |
| Framework | Vanilla TS | React, Vue, Svelte | Own render loop, no VDOM overhead |
| Icon library | Lucide | FontAwesome, Material | MIT, consistent style, SVG-native |
| Editor widget | Monaco | CodeMirror, Ace | VS Code engine, best YAML support |
| Drag library | interact.js | Custom, Hammer.js | Lightweight, MIT, handles resize+rotate |
| Canvas style | Split visual+payload | Pure visual, pure code | Unique differentiator, transparent format |
| Z-index system | Banded (0-9,10-19...) | Sequential | Safe insertion without renumbering |
| Token syntax | $token_name | {{token}}, var(--token) | Short, unambiguous, LLM-natural |
| Component props | {{prop_name}} | $prop, {prop} | Distinct from theme tokens, readable |
| MCP transport | stdio | HTTP/SSE | Local-only, no port conflicts |
| PDF export P1 | jsPDF+dom-to-image | Puppeteer | Client-side, no server needed in Phase 1 |
| PDF export P2 | Puppeteer | WeasyPrint, wkhtmltopdf | Pixel-perfect, same Chrome as preview |

---

*CLAUDE.md v1.0.0 — Generated from design session April 2026*
*Next review: after Phase 1 Week 2 (schema lock)*

---

## 17. ENGINE PERFORMANCE PRINCIPLES

### 17.1 Hard Constraints (Non-Negotiable)

This engine must be **lightweight and efficient by design**. Not aspirationally — enforced by measurable targets.

```
Cold start (editor open):          < 1 second
Design parse + first render:       < 100ms (50 layers)
Layer drag feedback:               < 16ms  (60fps minimum)
Export PNG 1080px ×2 scale:        < 3 seconds
Monaco editor load:                < 500ms
Initial JS bundle (gzipped):       < 500KB (excluding Monaco)
Memory usage (50-layer design):    < 50MB RAM
Memory usage (200-layer design):   < 150MB RAM
```

If a feature cannot be implemented without breaking these targets, the feature is deferred or redesigned — not the targets.

### 17.2 Render Architecture — Dirty Tracking

Never re-render the full canvas. Only re-render what changed.

```
Each layer maintains a render cache:
  layer.cache = {
    svg: SVGElement,        ← cached rendered output
    hash: string,           ← hash of all input props
    dirty: boolean          ← true = needs re-render
  }

On any change:
  1. Compute new prop hash for affected layer(s)
  2. Compare to cached hash
  3. If different → mark dirty, re-render only that layer
  4. If same → use cache, zero re-render cost

Full canvas re-render triggers:
  - theme change (all token refs may resolve differently)
  - zoom level change
  - canvas resize
  All other changes: targeted layer re-render only
```

### 17.3 Lazy Renderer Loading

Heavy renderers are not in the initial bundle. They load on first use.

```typescript
// Initial bundle (~500KB):
  SVG primitives renderer    (always loaded)
  Text renderer              (always loaded)
  Icon sprite                (always loaded)
  marked.js                  (always loaded — small)
  Token resolver             (always loaded)

// Lazy loaded on first encounter:
  mermaid          → import('mermaid')        when type: mermaid first seen
  vega-lite        → import('vega-lite')      when type: chart first seen
  katex            → import('katex')          when type: math first seen
  prism.js         → import('prismjs')        when type: code first seen
  dom-to-image     → import('dom-to-image-more') when export triggered
  interact.js      → import('interactjs')     when editor mode activated
```

### 17.4 Render Cost Budget Per Layer Type

```
rect / circle / line / polygon:   ~0.1ms   pure SVG, zero JS
text (plain):                     ~0.3ms   SVG text + font metrics
text (markdown):                  ~2ms     marked.js parse
icon:                             ~0.2ms   sprite lookup + SVG clone
image:                            ~5ms     decode + embed
component instance:               sum of children layers
mermaid diagram:                  ~50ms    first render; cache SVG after
vega-lite chart:                  ~30ms    first render; cache SVG after
katex math:                       ~5ms     first render; cache after
code block (prism):               ~3ms     tokenize + render
```

**Mermaid and Vega-Lite must always be cached.** Re-render only when their content string/spec changes. A diagram that hasn't changed costs ~0.1ms (cache lookup).

### 17.5 Bundle Discipline

```
ALLOWED (tree-shakeable, lightweight):
  ✓ marked.js         ~20KB
  ✓ js-yaml           ~45KB
  ✓ interact.js       ~30KB
  ✓ Floating UI       ~15KB
  ✓ lucide (sprite)   ~150KB (SVG, cached by browser)

LAZY LOADED (heavy, on-demand only):
  ~ mermaid           ~500KB
  ~ vega-lite         ~400KB
  ~ katex             ~280KB
  ~ prism.js          ~30KB + language files
  ~ dom-to-image-more ~20KB
  ~ Monaco Editor     ~2MB   (loaded once, cached by browser)

NEVER ALLOWED:
  ✗ React / Vue / Angular / Svelte
  ✗ jQuery
  ✗ Lodash (use native array/object methods)
  ✗ moment.js / date-fns (native Intl API only)
  ✗ axios (native fetch only)
  ✗ Any UI component library
  ✗ Bootstrap / Tailwind (CSS custom properties only)
```

### 17.6 Offline-First Hard Rule

The engine must work with **zero internet connection** after installation.

```
NEVER load from CDN at runtime:
  ✗ fonts.googleapis.com
  ✗ cdnjs.cloudflare.com
  ✗ unpkg.com
  ✗ any external URL

ALL assets must be local:
  ✓ Fonts: local WOFF2 in assets/fonts/ or bundled
  ✓ Icons: bundled SVG sprite
  ✓ Renderers: bundled JS (lazy chunks)
  ✓ Images: local project assets/images/
  ✓ Components: local project components/

Installation (one time only):
  npm install → pulls all dependencies
  After that: zero network required, ever
```

### 17.7 Deterministic Rendering

Same YAML → identical pixel output, always, everywhere.

```
Rules:
  No Math.random() in render path (seed any noise with layer id)
  No Date.now() in render path
  No window.innerWidth/Height in render path (use canvas dimensions)
  Font files versioned and pinned (update = explicit version bump)
  Gradient math: use exact SVG attribute values, not CSS computed values
  SVG filter params: explicit decimal precision (2dp minimum)

Why this matters:
  Version control diffs are meaningful
  CI/CD export pipeline produces consistent output
  Batch generation produces visually identical siblings
  LLM regeneration of same content = same visual result
```

### 17.8 Virtual Layer Panel

The layer panel must handle 200+ layers without performance degradation.

```
Implementation:
  Virtual scroll (only DOM-render visible rows)
  Row height: fixed 32px
  Visible rows: Math.ceil(panelHeight / 32) + 2 buffer
  Total DOM nodes: ~20-30 regardless of layer count

Group collapse:
  Collapsed group = 1 DOM node regardless of children count
  Expand = render children into virtual scroll pool
```

---

## 18. INTERACTIVE HTML OUTPUT

### 18.1 Two Output Modes

The engine supports two distinct output modes for HTML export:

```
Mode A: Presentation / Animated HTML
  → design-first
  → interactions are navigational or decorative
  → clickable slides, hover effects, scroll animations
  → no user-defined logic
  → output: self-contained HTML + CSS + minimal JS

Mode B: Interactive Document (Logic Layer)
  → design + behavior
  → buttons that execute actions
  → conditional visibility, state, data binding
  → user-defined TypeScript/JavaScript
  → output: self-contained HTML + embedded compiled TS
```

Phase 1 delivers Mode A.
Phase 2+ delivers Mode B (requires scripting layer).

### 18.2 Mode A — Interaction Schema

```yaml
# Layer-level interactions (Mode A)
- id: next_button
  type: rect
  z: 80
  ...
  interaction:
    on_click:
      action: next_page        # next_page | prev_page | goto_page | open_url
      target: null             # page id for goto_page
    on_hover:
      scale: 1.03
      shadow: $shadow_glow
      transition: 200ms ease
    cursor: pointer

- id: hero_card
  interaction:
    on_hover:
      fill.opacity: 0.9
      transform: translateY(-4px)
      transition: 300ms ease-out
```

### 18.3 Mode B — Logic Layer Schema

```yaml
# Design file addition for interactive documents
_protocol: "design/v1"
_output_mode: interactive      # static | presentation | interactive

# State definition (like React useState or Power Apps variables)
state:
  currentStep:
    type: number
    default: 0
  userName:
    type: string
    default: ""
  showDetails:
    type: boolean
    default: false

# Data bindings (like Power Apps data sources)
data:
  steps:
    type: static_array
    value:
      - { title: "Install", done: false }
      - { title: "Configure", done: false }
      - { title: "Test", done: false }

# Script blocks (TypeScript, compiled at export time)
scripts:
  - id: on_next_click
    language: typescript
    code: |
      state.currentStep = Math.min(
        state.currentStep + 1,
        data.steps.length - 1
      )

  - id: on_name_input
    language: typescript
    trigger: on_change
    code: |
      state.userName = event.target.value
```

### 18.4 Dynamic Layer Attributes (Mode B)

When scripting is enabled, layer attributes can be expressions:

```yaml
# Static (always)
- id: step_label
  content:
    type: plain
    value: "Step 3"

# Dynamic expression (Mode B only)
- id: step_label
  content:
    type: expression
    value: "`Step ${state.currentStep + 1} of ${data.steps.length}`"

# Conditional visibility
- id: details_panel
  visible:
    type: expression
    value: "state.showDetails === true"

# Dynamic style
- id: progress_bar
  width:
    type: expression
    value: "(state.currentStep / data.steps.length) * 920"
  fill:
    type: solid
    color:
      type: expression
      value: "state.currentStep === data.steps.length - 1 ? '$success' : '$primary'"
```

### 18.5 Interactive Element Types (Mode B)

```yaml
# Button
- id: next_btn
  type: button
  z: 80
  x: 880
  y: 960
  width: 120
  height: 48
  label: "Next →"
  style: $button_primary
  interaction:
    on_click: on_next_click    # script id

# Text input
- id: name_input
  type: input
  z: 30
  x: 80
  y: 400
  width: 400
  height: 48
  placeholder: "Enter your name"
  bind: state.userName          # two-way binding
  on_change: on_name_input

# Checkbox
- id: agree_check
  type: checkbox
  z: 30
  bind: state.agreed
  label: "I understand"

# Select / dropdown
- id: theme_select
  type: select
  z: 30
  bind: state.selectedTheme
  options:
    - { value: dark-tech, label: "Dark Tech" }
    - { value: light-clean, label: "Light Clean" }
```

### 18.6 Interactive HTML Export Pipeline (Mode B)

```
.design.yaml (with scripts + state + expressions)
        │
        ▼
TypeScript compiler (tsc, bundled with engine)
        │
        ├── compile script blocks
        ├── resolve expression strings
        └── tree-shake unused state/data
        │
        ▼
Single self-contained .html file:
  ├── SVG design layers (from renderer)
  ├── Compiled JS (from scripts)
  ├── State management runtime (~2KB, no framework)
  └── All assets embedded as base64
```

The state management runtime is **custom, minimal (~2KB)**. No React, no Vue, no framework. Just:
- `setState(key, value)` → update state → re-evaluate expressions → patch DOM
- `getData(id)` → return data binding value
- `trigger(scriptId, event)` → run script block

---

## 19. SCRIPTING / FORMULA LANGUAGE

### 19.1 Philosophy

```
Power Apps uses:   custom formula language (limited, proprietary)
This engine uses:  TypeScript/JavaScript (familiar, powerful, standard)

Tradeoffs:
  + Developers already know TS/JS
  + Full language power (loops, async, DOM access)
  + LLM generates TS/JS extremely well
  + No custom parser to build or maintain
  - More surface area for malicious code in untrusted designs
  → Mitigated by: sandboxed execution (iframe sandbox or SES)
```

### 19.2 Script Execution Context

Scripts run in a **sandboxed context** with access only to:

```typescript
// Available in script context:
state          // design state object (read/write)
data           // design data bindings (read/write)
event          // triggering event (read only)
pages          // page navigation API
assets         // project asset refs (read only)
utils          // safe utility functions

// Explicitly NOT available:
window         // no global DOM access
document       // no arbitrary DOM manipulation
fetch          // no network calls
XMLHttpRequest // no network calls
eval           // no dynamic code execution
require        // no module loading
```

### 19.3 Built-in Script Actions

Common interactions don't need custom scripts — use named actions:

```yaml
interaction:
  on_click:
    action: next_page
    action: prev_page
    action: goto_page(page_id)
    action: toggle_state(state.showDetails)
    action: set_state(state.step, 2)
    action: open_url(https://...)    # opens in new tab
    action: copy_text(state.result)
    action: download_file(export.png)
    action: submit_form(form_id)
    action: reset_state
```

Named actions cover 80% of interactive use cases. Custom TypeScript covers the rest.

### 19.4 LLM Script Generation

The LLM generates scripts the same way it generates layer specs — semantic and concise:

```
System prompt context given to LLM:
  "Available state: {currentStep: number, userName: string}
   Available data: {steps: array(5)}
   Script must only use: state, data, event, pages, utils
   Return TypeScript only, no imports, no export"

LLM output (~30 tokens):
  state.currentStep = Math.min(state.currentStep + 1, data.steps.length - 1)
```

Scripts in the payload are short. The engine wraps them in the sandbox context.

---

## 20. ADDITIONAL PRINCIPLES

### 20.1 Zero Silent Failures

```
Every error must surface visibly:
  YAML parse error     → Monaco inline error + Problems panel
  Token not found      → render placeholder + Problems panel warning
  Component not found  → render "missing component" box + error
  Layer type unknown   → render "unknown layer" placeholder + error
  Export failure       → toast error with specific reason
  Script runtime error → overlay error on affected layer

Never:
  - Log to console only
  - Silently skip a layer
  - Render partial/corrupted output without indication
```

### 20.2 Schema Validation as First-Class Feature

```
Validation runs:
  On file open (full validation)
  On every YAML edit (debounced 300ms, incremental)
  On export (full validation, block if errors)
  On MCP tool call (before writing to disk)

Validation catches:
  Unknown layer types
  Missing required fields (id, type, z, x, y, w, h)
  Duplicate layer IDs within same scope
  Duplicate z-index values within same scope
  Token references to non-existent theme keys
  Component refs to non-existent component files
  Color values that fail WCAG AA contrast (warning only)
  pos array wrong length (must be exactly 4 values)
  Circular component dependencies
```

### 20.3 Accessibility of Exported HTML

```
All exported HTML must:
  ✓ Include alt text on image layers (from meta.alt_text field)
  ✓ Use semantic heading hierarchy (h1 > h2 > h3)
  ✓ Include ARIA labels on interactive elements
  ✓ Be keyboard navigable (Tab through interactive elements)
  ✓ Pass WCAG AA color contrast (4.5:1 for body, 3:1 for large text)
  ✓ Include lang attribute on html element
  ✓ Not rely on color alone to convey information

Layer additions for accessibility:
  - id: hero_image
    type: image
    meta:
      alt_text: "Diagram showing MCP server architecture"
```

### 20.4 Single Responsibility Per File

```
Each file does exactly one thing:
  project.yaml          → registry and config only, no design data
  *.theme.yaml          → tokens only, no layer definitions
  *.component.yaml      → one reusable component only
  *.template.yaml       → one template layout only
  *.design.yaml         → one design document only

Cross-file dependencies always go one direction:
  design → template → component → theme
  design → component → theme
  design → theme

Never:
  theme referencing a design
  component referencing a design
  circular references of any kind
```

### 20.5 Future-Proofing Rules

```
Protocol versioning:
  Every file has _protocol: "type/vN"
  Breaking changes bump major version
  Additive changes bump minor version
  Engine maintains compatibility for N-2 versions back

Field addition (safe, additive):
  Add new optional field with default → existing files still valid

Field removal (breaking):
  Deprecate for one minor version with warning
  Remove in next major version only

Field rename (breaking):
  Never rename — add new field, deprecate old, remove after migration

Animation readiness (enforced now):
  All style properties must be discrete typed fields
  No style string blobs ever
  This rule cannot be relaxed — see Section 12.5
```

---

## 21. UPDATED DESIGN DECISIONS LOG

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Bundle size target | <500KB initial | No limit | Forces lazy loading discipline |
| Render strategy | Dirty tracking per layer | Full redraw | 60fps drag performance |
| Heavy renderer loading | Lazy on first use | Always bundled | Keeps cold start <1s |
| Offline requirement | Hard constraint | Nice to have | Core philosophy, not optional |
| Deterministic render | Hard constraint | Best effort | Enables CI/CD, version control |
| Error handling | Visible always | Console only | Design tools must show problems |
| Interactive output | Two modes (A+B) | One mode | Mode A simpler, Mode B powerful |
| Scripting language | TypeScript/JS | Custom formula | Familiar, LLM-friendly, standard |
| Script sandbox | iframe/SES sandbox | None | Security without custom parser |
| State management | Custom 2KB runtime | React/Vue/Svelte | No framework, minimal overhead |
| Accessibility | Required in export | Optional | Output quality standard |
| Schema validation | First-class, always on | Best effort | Silent failures are unacceptable |
| File dependency direction | One direction only | Circular allowed | Prevents dependency hell |
| Protocol versioning | Semantic versioning | None | Breaking change safety |

---

*CLAUDE.md v1.1.0 — Updated with performance principles, interactive output, scripting layer*
*Sections added: 17 (Engine Performance), 18 (Interactive HTML), 19 (Scripting), 20 (Additional Principles), 21 (Updated Decisions)*

---

## 22. TESTING STRATEGY

### 22.1 Testing Philosophy

```
Every unit of code ships with tests.
No feature is complete without passing tests.
No PR merges with failing tests.
Tests are written alongside code, not after.
Production-ready = tested, not just working.
```

### 22.2 Test Stack

```
Vitest              — unit + integration tests (Vite-native, fast)
@vitest/coverage-v8 — code coverage (target: >80% overall, >95% schema/renderer)
Playwright          — E2E + visual regression tests (headless Chromium/Firefox/WebKit)
@vitest/ui          — test dashboard (visual test runner)
vitest-canvas-mock  — mock canvas API for unit tests
```

### 22.3 Test File Conventions

```
src/
  renderer/
    rect.ts
    rect.test.ts           ← unit test lives next to source file
    rect.spec.ts           ← (alternative naming, pick one and stick to it)
  schema/
    token-resolver.ts
    token-resolver.test.ts
  editor/
    interactions.ts
    interactions.test.ts

tests/
  e2e/
    editor-basic.spec.ts   ← Playwright E2E tests
    export.spec.ts
    mcp-tools.spec.ts
  visual/
    snapshots/             ← Playwright screenshot baselines
    renderer.visual.ts     ← visual regression tests
  fixtures/
    designs/               ← sample .design.yaml files for tests
    themes/
    components/
```

### 22.4 Unit Test Requirements Per Module

#### Schema & Token Resolver
```typescript
// Must test:
✓ Valid YAML parses without error
✓ Invalid YAML throws with clear message
✓ $token resolves to correct theme value
✓ Nested token resolves ($primary inside gradient stop)
✓ Unknown token throws warning, uses fallback
✓ Circular token reference detected and throws
✓ pos: [x,y,w,h] shorthand expands correctly
✓ pos: grid(...) expands to correct px values
✓ All 5 fill types parse correctly
✓ Protocol version mismatch throws clear error
✓ Missing required field (id, type, z) throws clear error
✓ Duplicate layer ID detected
✓ Duplicate z-index detected

Coverage target: 95%
```

#### SVG Renderer
```typescript
// Must test per layer type:
✓ rect: renders correct SVG element with all attributes
✓ circle: renders correct cx,cy,rx,ry
✓ text: renders correct font attributes
✓ text (markdown): output contains expected HTML structure
✓ icon: resolves name to correct SVG path
✓ image: encodes src as data URI correctly
✓ component: resolves slots into child layers
✓ mermaid: produces non-empty SVG output
✓ chart (vega-lite): produces non-empty SVG output

// Must test fill types:
✓ solid fill: correct SVG fill attribute
✓ linear gradient: correct linearGradient element
✓ radial gradient: correct radialGradient element
✓ multi gradient: multiple gradient elements stacked
✓ noise overlay: feTurbulence filter present

// Must test effects:
✓ drop shadow: correct feDropShadow filter
✓ backdrop blur: correct filter attribute
✓ blend mode: correct mix-blend-mode

// Determinism test (critical):
✓ Same YAML input → identical SVG output on repeated calls
✓ Same YAML input → identical SVG output across test runs

Coverage target: 90%
```

#### Canvas Interactions
```typescript
// Must test (via Playwright):
✓ Click on layer → layer selected, handles visible
✓ Click on empty canvas → selection cleared
✓ Drag layer → x,y updated in YAML
✓ Resize handle drag → width,height updated
✓ Rotate handle drag → rotation updated
✓ Shift+click → multi-select
✓ Marquee drag → all overlapping layers selected
✓ Drag selected group → all layers move together
✓ Undo (Cmd+Z) → layer returns to previous position
✓ Redo (Cmd+Shift+Z) → layer returns to new position
✓ Snap to grid → position snaps to nearest grid unit
✓ Snap to other layer edge → position snaps correctly

Coverage target: 80%
```

#### Token Resolution
```typescript
// Must test:
✓ $primary → theme.colors.primary value
✓ $heading → theme.typography.families.heading
✓ $shadow_card → theme.effects.shadow_card
✓ $radius_lg → theme.radii.lg
✓ Nested: fill.stops[0].color: "$primary" resolves
✓ Override: design theme.overrides takes precedence over theme file
✓ Missing token: warns, returns fallback (#FF00FF "debug pink")

Coverage target: 98%
```

#### Export Pipeline
```typescript
// Must test:
✓ PNG export produces valid PNG file
✓ PNG export at ×1, ×2, ×3 scale produces correct dimensions
✓ SVG export produces valid SVG markup
✓ HTML export is self-contained (no external URLs)
✓ HTML export opens and renders in headless browser
✓ PDF export produces valid PDF (page count, dimensions)
✓ Font is embedded in HTML export (base64 present)
✓ All images embedded as data URIs in HTML export

Coverage target: 85%
```

#### MCP Tools (Phase 2)
```typescript
// Must test per tool:
✓ create_design: produces valid .design.yaml
✓ append_page: page count increments correctly
✓ patch_design: correct field updated, nothing else changed
✓ seal_design: _mode set to complete
✓ export_design: output file exists and is non-empty
✓ batch_create: N designs created for N slot arrays
✓ resume_design: continues from last completed_pages
✓ Concurrent write protection: second write waits for first

Coverage target: 90%
```

### 22.5 Visual Regression Tests

```typescript
// Playwright visual snapshots
// Run against real browser, compare pixel output

test('rect with linear gradient renders correctly', async ({ page }) => {
  await page.goto('/test-renderer?fixture=rect-gradient')
  await expect(page).toHaveScreenshot('rect-gradient.png', {
    maxDiffPixelRatio: 0.01   // 1% pixel difference tolerance
  })
})

// Fixtures: designs in tests/fixtures/designs/
// Each fixture is a minimal .design.yaml with one notable feature
// Baseline snapshots committed to repo
// CI fails if any snapshot differs beyond threshold
```

### 22.6 Performance Tests

```typescript
// Vitest bench (built-in benchmarking)
bench('token resolver — 50 tokens', () => {
  resolveTokens(fiftyLayerDesign, darkTechTheme)
})
// Must complete in < 10ms

bench('SVG renderer — 50 layers', () => {
  renderDesign(fiftyLayerDesign)
})
// Must complete in < 100ms

bench('YAML parse — 200 layer file', () => {
  parseDesignFile(twoHundredLayerYAML)
})
// Must complete in < 50ms
```

### 22.7 Coverage Targets Summary

| Module | Target |
|---|---|
| Schema validation | 95% |
| Token resolver | 98% |
| SVG renderer | 90% |
| Canvas interactions | 80% |
| Export pipeline | 85% |
| MCP tools | 90% |
| Component system | 85% |
| Overall project | >80% |

CI blocks merge if any module falls below its target.

---

## 23. CI/CD PIPELINES

### 23.1 ci.yml — Continuous Integration

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ── LINT & TYPE CHECK ──────────────────────────────────────
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  # ── UNIT TESTS ─────────────────────────────────────────────
  unit-tests:
    name: Unit Tests (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['18', '20']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        if: matrix.os == 'ubuntu-latest' && matrix.node == '20'
        with:
          flags: unit-${{ matrix.os }}

  # ── VISUAL REGRESSION ──────────────────────────────────────
  visual-tests:
    name: Visual Regression Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:visual
      - name: Upload visual diff artifacts
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-regression-diffs
          path: tests/visual/diffs/
          retention-days: 7

  # ── E2E TESTS ──────────────────────────────────────────────
  e2e-tests:
    name: E2E Tests (${{ matrix.browser }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps ${{ matrix.browser }}
      - run: npm run test:e2e -- --project=${{ matrix.browser }}
      - name: Upload E2E artifacts on failure
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-${{ matrix.browser }}-artifacts
          path: tests/e2e/artifacts/
          retention-days: 7

  # ── BUILD CHECK ────────────────────────────────────────────
  build:
    name: Build Check (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Check bundle size
        run: npm run build:analyze
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-${{ matrix.os }}
          path: dist/
          retention-days: 3

  # ── PERFORMANCE BENCH ──────────────────────────────────────
  performance:
    name: Performance Benchmarks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:bench
      - name: Store benchmark results
        uses: benchmark-action/github-action-benchmark@v1
        with:
          tool: 'vitest'
          output-file-path: bench-results.json
          fail-on-alert: true
          alert-threshold: '130%'   # fail if 30% slower than baseline
```

### 23.2 release.yml — Release Pipeline

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  # ── VALIDATE TAG ───────────────────────────────────────────
  validate:
    name: Validate Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate version matches package.json
        run: |
          TAG_VERSION=${GITHUB_REF#refs/tags/v}
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag $TAG_VERSION does not match package.json $PKG_VERSION"
            exit 1
          fi
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run typecheck

  # ── BUILD ALL PLATFORMS ────────────────────────────────────
  build:
    name: Build (${{ matrix.os }})
    needs: validate
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
            artifact: design-engine-linux
          - os: macos-latest
            platform: mac
            artifact: design-engine-mac
          - os: windows-latest
            platform: windows
            artifact: design-engine-windows
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Package for ${{ matrix.platform }}
        shell: bash
        run: |
          mkdir -p release/${{ matrix.artifact }}
          cp -r dist/ release/${{ matrix.artifact }}/
          cp scripts/install.sh release/${{ matrix.artifact }}/   # linux/mac
          cp scripts/install.ps1 release/${{ matrix.artifact }}/  # windows
          cp README.md CHANGELOG.md release/${{ matrix.artifact }}/
          cd release && tar -czf ${{ matrix.artifact }}.tar.gz ${{ matrix.artifact }}/
      - name: Upload release artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: release/${{ matrix.artifact }}.tar.gz

  # ── GITHUB RELEASE ─────────────────────────────────────────
  release:
    name: Create GitHub Release
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: release-artifacts/
      - name: Extract changelog for this version
        id: changelog
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          node scripts/extract-changelog.js $VERSION > release-notes.md
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: release-notes.md
          draft: false
          prerelease: ${{ contains(github.ref, '-beta') || contains(github.ref, '-alpha') }}
          files: |
            release-artifacts/design-engine-linux/*.tar.gz
            release-artifacts/design-engine-mac/*.tar.gz
            release-artifacts/design-engine-windows/*.tar.gz
          generate_release_notes: false
```

### 23.3 Package Scripts (package.json)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:analyze": "vite build --mode analyze",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx --max-warnings 0",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:unit:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:visual": "playwright test tests/visual/",
    "test:e2e": "playwright test tests/e2e/",
    "test:bench": "vitest bench",
    "test:update-snapshots": "playwright test --update-snapshots",
    "release": "sh scripts/release.sh",
    "clean": "rm -rf dist node_modules .vite"
  }
}
```

---

## 24. MULTIPLATFORM PRINCIPLES

### 24.1 Platform Support Matrix

```
FULL FEATURE SET (primary targets):
  Chrome 120+    (desktop)     ← primary development target
  Chrome 120+    (Android)     ← tablet + phone
  Safari 17+     (desktop)     ← macOS
  Safari 17+     (iOS)         ← iPad + iPhone
  Firefox 121+   (desktop)     ← secondary

DEGRADED GRACEFULLY:
  Chrome (older) → notify user, suggest update
  Edge           → treated same as Chrome (Chromium)

NOT SUPPORTED:
  IE11           → never
  Opera Mini     → never
```

### 24.2 Device Tier Definitions

```
TIER 1 — Desktop (full editor):
  Viewport: ≥ 1024px wide
  Input: mouse + keyboard
  Features: all features, all panels, all shortcuts
  Canvas: centered, fixed aspect ratio, zoomable

TIER 2 — Tablet (full editor, touch-adapted):
  Viewport: 768px–1023px wide
  Input: touch (no hover), optional keyboard
  Features: all features (panels collapsible)
  Canvas: full-width, pinch-to-zoom
  Changes vs Tier 1:
    - Larger touch targets (min 44×44px per WCAG)
    - Touch-friendly drag handles (larger hit area)
    - Panels collapse to bottom sheet or drawer
    - No hover-dependent interactions
    - Long-press = right-click context menu

TIER 3 — Mobile phone (view + simple edit):
  Viewport: < 768px wide
  Input: touch only
  Features: VIEW mode + text slot editing only
  No: drag/resize, layer panel, Monaco editor
  Canvas: full-width, pinch-zoom view only
  Edit: tap text layer → modal editor for content only
  Export: PNG/PDF only (no design changes)
```

### 24.3 Touch Event Handling

```typescript
// All interactions must handle both mouse and touch:

// WRONG — mouse only:
element.addEventListener('mousedown', handleDragStart)
element.addEventListener('mousemove', handleDrag)
element.addEventListener('mouseup', handleDragEnd)

// RIGHT — unified pointer events (handles mouse, touch, stylus):
element.addEventListener('pointerdown', handleDragStart)
element.addEventListener('pointermove', handleDrag)
element.addEventListener('pointerup', handleDragEnd)
element.setPointerCapture(event.pointerId)  // prevent losing events

// Touch-specific additions:
// Pinch-to-zoom → canvas zoom
// Two-finger pan → canvas pan
// Long-press (500ms) → context menu
// Double-tap → enter text edit
```

### 24.4 Responsive Layout Breakpoints

```css
/* CSS custom properties for breakpoints */
:root {
  --bp-mobile:  767px;
  --bp-tablet:  1023px;
  --bp-desktop: 1024px;
}

/* Layout changes per tier */
@media (max-width: 767px) {
  .file-tree { display: none; }
  .layer-panel { display: none; }
  .properties-panel { display: none; }
  .canvas-area { width: 100%; }
  .toolbar { position: fixed; bottom: 0; }
}

@media (768px) and (max-width: 1023px) {
  .file-tree { position: drawer; }
  .layer-panel { position: bottom-sheet; }
  .properties-panel { position: bottom-sheet; }
  .canvas-area { width: 100%; }
}
```

### 24.5 File System Access Per Platform

```
Desktop Chrome:    File System Access API (full read/write)
Desktop Firefox:   <input type="file"> fallback + download for save
Desktop Safari:    <input type="file"> fallback + download for save
Android Chrome:    <input type="file"> + download
iOS Safari:        <input type="file"> + share sheet export

Abstraction layer (src/fs/index.ts):
  openFile(accept) → File object (all platforms)
  saveFile(content, filename) → void (FSA or download fallback)
  watchFile(path, callback) → unwatch fn (desktop only, no-op on mobile)
  isNativeFS() → boolean (true only on desktop Chrome)
```

### 24.6 Cross-Platform Font Rendering

```
Problem: fonts render slightly differently per OS/browser
         macOS antialiasing ≠ Windows ClearType ≠ Linux subpixel

Solution:
  1. Use variable fonts (single file, consistent metrics)
  2. Disable OS font smoothing for design canvas only:
     canvas { -webkit-font-smoothing: antialiased;
               font-smooth: never; }
  3. Visual regression tests run on Ubuntu (consistent baseline)
  4. Export uses Puppeteer on Linux in CI (consistent PDF/PNG)
  5. Document: visual output may vary ±1px between OS — this is expected
```

---

## 25. PRODUCTION-READY PRINCIPLES

### 25.1 Definition of Done

A feature is NOT done until all of the following are true:

```
Code:
  [ ] TypeScript — zero type errors (strict mode)
  [ ] No TODOs or FIXMEs in merged code
  [ ] No console.log in production builds (use debug utility)
  [ ] All error paths handled (no unhandled promise rejections)
  [ ] No unused variables, imports, or exports

Tests:
  [ ] Unit tests written and passing
  [ ] Coverage target met for this module
  [ ] Visual snapshot updated if render changed
  [ ] E2E test covers the user-facing flow
  [ ] Performance benchmark passes

Documentation:
  [ ] JSDoc on all public functions
  [ ] CLAUDE.md updated if architecture changed
  [ ] CHANGELOG.md entry added

CI:
  [ ] All CI checks green on PR
  [ ] No bundle size regression > 5%
  [ ] No performance regression > 10%
  [ ] Peer reviewed (or self-reviewed with checklist)
```

### 25.2 Versioning Strategy

```
Semantic Versioning: MAJOR.MINOR.PATCH

PATCH (1.0.x): bug fixes, no new features
  → auto-release on merge to main if all tests pass

MINOR (1.x.0): new features, backward compatible
  → manual release trigger
  → CHANGELOG.md required

MAJOR (x.0.0): breaking changes to file format or public API
  → migration guide required
  → deprecation notice in previous MINOR first

Version locations (must stay in sync):
  package.json     → source of truth
  CLAUDE.md        → header version
  _protocol field  → file format version (separate from app version)
```

### 25.3 Logging Strategy

```typescript
// src/utils/debug.ts
// Wraps console — strips from production builds (tree-shaken)

import { debug } from '@/utils/debug'

debug.log('renderer', 'Rendering layer', layer.id)
debug.warn('schema', 'Unknown token', tokenName)
debug.error('export', 'Font load failed', error)
debug.perf('renderer', 'SVG render time', duration)

// In production: all debug.* calls tree-shaken to nothing
// In development: output with module prefix and timestamp
// Never: raw console.log in source code
```

### 25.4 Error Boundary Strategy

```typescript
// Every async operation has explicit error handling
// Every render path has a fallback

// WRONG:
const svg = await renderLayer(layer)
canvas.append(svg)

// RIGHT:
try {
  const svg = await renderLayer(layer)
  canvas.append(svg)
} catch (error) {
  const placeholder = renderErrorPlaceholder(layer, error)
  canvas.append(placeholder)
  problemsPanel.add({ severity: 'error', layer: layer.id, message: error.message })
}
```

### 25.5 Security Principles

```
Input validation:
  All YAML parsed through schema validator before use
  No eval() in production code (except sandboxed script runner)
  All user content treated as untrusted until validated

Script sandbox (Mode B interactive):
  Scripts run in sandboxed iframe (sandbox="allow-scripts")
  postMessage communication only (no shared DOM)
  Strict Content Security Policy on exported HTML

File system:
  Only read/write within user-selected project folder
  No access to system directories
  No network requests from engine at runtime

Dependencies:
  npm audit on every CI run
  Dependabot enabled for security updates
  No dependencies with known critical CVEs
```

### 25.6 CHANGELOG.md Format

```markdown
# Changelog

## [Unreleased]

## [1.2.0] - 2026-05-01
### Added
- Component override system (locked_props support)
- Visual regression test suite

### Fixed
- Font loading race condition on slow storage
- Z-index conflict detection false positive with groups

### Changed
- Token syntax changed from {{token}} to $token (migration guide below)

### Migration
- Replace all {{color}} references with $color in design files
- Run: node scripts/migrate-tokens.js ./designs/
```

---

## 26. INSTALLATION SCRIPTS

### 26.1 Script Overview

```
scripts/
  install.sh          ← Mac/Linux: full install from scratch
  install.ps1         ← Windows: full install from scratch
  uninstall.sh        ← Mac/Linux: clean removal
  uninstall.ps1       ← Windows: clean removal
  dev.sh              ← Mac/Linux: start dev server
  dev.ps1             ← Windows: start dev server
  build.sh            ← Mac/Linux: production build
  build.ps1           ← Windows: production build
  test.sh             ← Mac/Linux: run all tests
  test.ps1            ← Windows: run all tests
  update.sh           ← Mac/Linux: pull + rebuild
  update.ps1          ← Windows: pull + rebuild
  health-check.sh     ← Mac/Linux: verify installation
  health-check.ps1    ← Windows: verify installation
  release.sh          ← Mac/Linux: bump version + tag + push
  migrate-tokens.js   ← cross-platform: YAML migration utility
  extract-changelog.js← cross-platform: CI release notes extractor
```

### 26.2 install.sh

```bash
#!/usr/bin/env bash
# install.sh — Design Engine installer for Mac and Linux
set -euo pipefail

REQUIRED_NODE="18"
INSTALL_DIR="${HOME}/.design-engine"
REPO_URL="https://github.com/your-org/design-engine"

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${BLUE}[install]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ── Check OS ──────────────────────────────────────────────────
OS="$(uname -s)"
case "${OS}" in
  Linux*)  PLATFORM=linux ;;
  Darwin*) PLATFORM=mac ;;
  *)       error "Unsupported OS: ${OS}" ;;
esac
log "Platform: ${PLATFORM}"

# ── Check Node.js ─────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  error "Node.js not found. Install Node.js ${REQUIRED_NODE}+ from https://nodejs.org"
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "${NODE_VERSION}" -lt "${REQUIRED_NODE}" ]; then
  error "Node.js ${NODE_VERSION} found. Requires ${REQUIRED_NODE}+."
fi
success "Node.js ${NODE_VERSION} found"

# ── Check npm ─────────────────────────────────────────────────
if ! command -v npm &> /dev/null; then
  error "npm not found. Reinstall Node.js from https://nodejs.org"
fi
success "npm $(npm --version) found"

# ── Check Git ─────────────────────────────────────────────────
if ! command -v git &> /dev/null; then
  error "git not found. Install git from https://git-scm.com"
fi
success "git $(git --version | cut -d' ' -f3) found"

# ── Clone or update repo ───────────────────────────────────────
if [ -d "${INSTALL_DIR}" ]; then
  warn "Existing installation found at ${INSTALL_DIR}"
  log "Updating existing installation..."
  cd "${INSTALL_DIR}"
  git pull origin main
else
  log "Installing to ${INSTALL_DIR}..."
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
fi

# ── Install dependencies ───────────────────────────────────────
log "Installing dependencies (this may take a minute)..."
npm ci --prefer-offline 2>/dev/null || npm install
success "Dependencies installed"

# ── Build production bundle ────────────────────────────────────
log "Building production bundle..."
npm run build
success "Build complete"

# ── Install Playwright browsers (for testing only) ─────────────
if [ "${1:-}" = "--with-tests" ]; then
  log "Installing Playwright browsers..."
  npx playwright install chromium firefox webkit
  success "Playwright browsers installed"
fi

# ── Create launcher ───────────────────────────────────────────
LAUNCHER="/usr/local/bin/design-engine"
cat > /tmp/design-engine-launcher << EOF
#!/usr/bin/env bash
cd "${INSTALL_DIR}" && npm run preview -- --open
EOF
chmod +x /tmp/design-engine-launcher

if [ -w "/usr/local/bin" ]; then
  cp /tmp/design-engine-launcher "${LAUNCHER}"
  success "Launcher installed: design-engine"
else
  warn "Cannot write to /usr/local/bin (needs sudo)"
  warn "Run manually: sudo cp /tmp/design-engine-launcher /usr/local/bin/design-engine"
fi

# ── Health check ──────────────────────────────────────────────
log "Running health check..."
bash "${INSTALL_DIR}/scripts/health-check.sh"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Design Engine installed successfully!   ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Start:   ${BLUE}design-engine${NC}"
echo -e "  Dev:     ${BLUE}cd ${INSTALL_DIR} && npm run dev${NC}"
echo -e "  Test:    ${BLUE}cd ${INSTALL_DIR} && npm test${NC}"
echo ""
```

### 26.3 uninstall.sh

```bash
#!/usr/bin/env bash
# uninstall.sh — Clean removal of Design Engine
set -euo pipefail

INSTALL_DIR="${HOME}/.design-engine"
LAUNCHER="/usr/local/bin/design-engine"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }

echo ""
echo -e "${RED}This will remove Design Engine from your system.${NC}"
echo "Projects in your personal folders will NOT be deleted."
echo ""
read -r -p "Continue? (y/N): " confirm
if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
  echo "Uninstall cancelled."
  exit 0
fi

# Remove installation directory
if [ -d "${INSTALL_DIR}" ]; then
  rm -rf "${INSTALL_DIR}"
  success "Removed ${INSTALL_DIR}"
else
  warn "Installation directory not found: ${INSTALL_DIR}"
fi

# Remove launcher
if [ -f "${LAUNCHER}" ]; then
  rm -f "${LAUNCHER}" 2>/dev/null || sudo rm -f "${LAUNCHER}"
  success "Removed launcher"
else
  warn "Launcher not found: ${LAUNCHER}"
fi

success "Design Engine uninstalled."
echo "Your project files are untouched."
```

### 26.4 health-check.sh

```bash
#!/usr/bin/env bash
# health-check.sh — Verify installation is correct
set -euo pipefail

INSTALL_DIR="${HOME}/.design-engine"
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0

check() {
  local name="$1"; local cmd="$2"
  if eval "${cmd}" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} ${name}"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} ${name}"
    ((FAIL++))
  fi
}

echo "Health Check:"
check "Node.js 18+"            "node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)'"
check "npm available"          "command -v npm"
check "Installation directory" "[ -d '${INSTALL_DIR}' ]"
check "node_modules present"   "[ -d '${INSTALL_DIR}/node_modules' ]"
check "dist/ build present"    "[ -d '${INSTALL_DIR}/dist' ]"
check "index.html built"       "[ -f '${INSTALL_DIR}/dist/index.html' ]"
check "package.json valid"     "node -e \"require('${INSTALL_DIR}/package.json')\""

echo ""
echo "  Passed: ${PASS} | Failed: ${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  echo -e "${RED}Health check failed. Run install.sh to repair.${NC}"
  exit 1
fi
echo -e "${GREEN}All checks passed.${NC}"
```

### 26.5 dev.sh

```bash
#!/usr/bin/env bash
# dev.sh — Start development server
set -euo pipefail
INSTALL_DIR="${HOME}/.design-engine"

if [ ! -d "${INSTALL_DIR}" ]; then
  echo "Not installed. Run: bash install.sh"
  exit 1
fi

cd "${INSTALL_DIR}"
echo "Starting dev server..."
npm run dev
```

### 26.6 update.sh

```bash
#!/usr/bin/env bash
# update.sh — Pull latest changes and rebuild
set -euo pipefail
INSTALL_DIR="${HOME}/.design-engine"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

log()     { echo -e "${BLUE}[update]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }

cd "${INSTALL_DIR}"

CURRENT=$(git rev-parse --short HEAD)
log "Current version: ${CURRENT}"
log "Pulling latest..."
git pull origin main

LATEST=$(git rev-parse --short HEAD)
if [ "${CURRENT}" = "${LATEST}" ]; then
  success "Already up to date."
  exit 0
fi

log "Changes detected. Rebuilding..."
npm ci --prefer-offline 2>/dev/null || npm install
npm run build
bash scripts/health-check.sh

success "Updated: ${CURRENT} → ${LATEST}"
```

### 26.7 install.ps1 (Windows PowerShell)

```powershell
# install.ps1 — Design Engine installer for Windows
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REQUIRED_NODE = 18
$INSTALL_DIR = "$env:USERPROFILE\.design-engine"
$REPO_URL = "https://github.com/your-org/design-engine"

function Log($msg)     { Write-Host "[install] $msg" -ForegroundColor Blue }
function Success($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

# Check Node.js
try {
  $nodeVersion = (node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if ([int]$nodeVersion -lt $REQUIRED_NODE) {
    Fail "Node.js $nodeVersion found. Requires $REQUIRED_NODE+."
  }
  Success "Node.js $nodeVersion found"
} catch {
  Fail "Node.js not found. Install from https://nodejs.org"
}

# Check Git
try {
  git --version | Out-Null
  Success "Git found"
} catch {
  Fail "Git not found. Install from https://git-scm.com"
}

# Clone or update
if (Test-Path $INSTALL_DIR) {
  Warn "Existing installation found. Updating..."
  Set-Location $INSTALL_DIR
  git pull origin main
} else {
  Log "Installing to $INSTALL_DIR..."
  git clone $REPO_URL $INSTALL_DIR
  Set-Location $INSTALL_DIR
}

# Install deps and build
Log "Installing dependencies..."
npm ci --prefer-offline 2>$null
if ($LASTEXITCODE -ne 0) { npm install }
Success "Dependencies installed"

Log "Building..."
npm run build
Success "Build complete"

# Create launcher batch file
$launcherDir = "$env:USERPROFILE\AppData\Local\Microsoft\WindowsApps"
$launcherContent = "@echo off`ncd /d `"$INSTALL_DIR`" && npm run preview -- --open"
$launcherPath = "$launcherDir\design-engine.cmd"
try {
  Set-Content -Path $launcherPath -Value $launcherContent
  Success "Launcher installed: design-engine"
} catch {
  Warn "Could not install launcher to PATH. Run manually from: $INSTALL_DIR"
}

Write-Host ""
Write-Host "Design Engine installed successfully!" -ForegroundColor Green
Write-Host "Start: design-engine" -ForegroundColor Cyan
Write-Host "Dev:   cd $INSTALL_DIR; npm run dev" -ForegroundColor Cyan
```

---

## 27. UPDATED BUILD ROADMAP (WITH TESTING + SCRIPTS)

### Phase 1 — Week-by-Week (Revised)

```
Week 1:
  [ ] project scaffold (Vite + TS + ESLint + Vitest + Playwright)
  [ ] install.sh + uninstall.sh + health-check.sh
  [ ] install.ps1 + uninstall.ps1
  [ ] ci.yml (lint + unit tests only for now)
  [ ] schema + token resolver + 95% unit test coverage
  [ ] static renderer: rect, circle, text (plain), icon
  Milestone: npm install → dev server → renders basic YAML

Week 2:
  [ ] all fill types (solid, linear, radial, multi, noise)
  [ ] all text subtypes (markdown, rich, spans)
  [ ] SVG filters (shadow, blur, glow, blend mode)
  [ ] visual regression test baseline (Playwright snapshots)
  [ ] ci.yml: add visual regression job
  Milestone: full layer type coverage, snapshots committed

Week 3:
  [ ] Monaco editor integration
  [ ] bidirectional live sync (YAML ↔ canvas)
  [ ] Problems panel (schema validation errors)
  [ ] dev.sh + build.sh + test.sh
  Milestone: edit YAML → canvas updates, errors shown inline

Week 4–5:
  [ ] interact.js: select, drag, resize
  [ ] rotation handle
  [ ] multi-select + group transform
  [ ] undo/redo (immutable state stack)
  [ ] snap to grid + snap to layer
  [ ] Playwright E2E: drag, resize, undo
  Milestone: full canvas interaction loop

Week 6:
  [ ] layer panel (virtual scroll, z-band groups)
  [ ] properties panel (context-aware per type)
  [ ] gradient editor in properties panel
  [ ] alignment tools
  Milestone: click layer → edit all props visually

Week 7:
  [ ] component system (ref, slots, overrides)
  [ ] template system (locked layout, slot validation)
  [ ] component index + registry
  [ ] update.sh + release.sh
  Milestone: insert component from library, fill slots

Week 8:
  [ ] export: PNG (dom-to-image)
  [ ] export: SVG (serialize)
  [ ] export: self-contained HTML (embed fonts + assets)
  [ ] export: PDF (jsPDF)
  [ ] project file system (FSA + fallback)
  [ ] file watcher (polling)
  Milestone: full export pipeline, all formats

Week 9:
  [ ] command palette (/ shortcut)
  [ ] keyboard shortcuts (all from spec)
  [ ] multi-page carousel editor (page strip)
  [ ] touch event support (pointer events)
  [ ] mobile responsive layout (Tier 3 view-only)
  Milestone: carousel editing, mobile view works

Week 10:
  [ ] release.yml (full multi-platform release pipeline)
  [ ] coverage reporting (Codecov)
  [ ] performance benchmarks (vitest bench)
  [ ] bundle size analysis (<500KB gate in CI)
  [ ] cross-browser testing (Playwright matrix)
  [ ] CHANGELOG.md v1.0.0 entry
  [ ] tag v1.0.0 → release pipeline triggers
  Milestone: v1.0.0 released on all platforms
```

---

*CLAUDE.md v1.2.0 — Added: testing strategy, CI/CD pipelines, multiplatform principles,*
*production-ready standards, installation scripts, updated roadmap*
*Sections: 22 (Testing), 23 (CI/CD), 24 (Multiplatform), 25 (Production-Ready), 26 (Scripts), 27 (Roadmap)*
