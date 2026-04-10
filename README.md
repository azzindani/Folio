# Folio

A local-first, file-based graphic design engine. Designs are stored as human-readable YAML files. A browser-based editor renders and manipulates them visually. An LLM can generate or modify designs via structured YAML payloads.

**No cloud. No subscriptions. No internet after install.**

---

## Features

- **YAML-native design files** — every design is a plain `.design.yaml` file you can read, edit, and version-control
- **Live bidirectional editor** — toggle between visual canvas and raw YAML; both stay in sync
- **SVG renderer** — vector-native output, pixel-perfect at any scale
- **Export pipeline** — PNG (×1/×2/×3), SVG, PDF, self-contained HTML
- **Theme system** — design tokens (`$primary`, `$heading`, etc.) resolved at render time
- **Component library** — reusable layer groups with slot definitions
- **Monaco YAML editor** — VS Code engine, inline validation, syntax highlighting
- **Undo/redo** — full history, keyboard shortcuts
- **Command palette** — search and execute any action via `Ctrl+K` or `/`
- **Layer panel** — grouped by z-band, virtual scroll handles 200+ layers
- **File watcher** — external edits in VS Code reload the canvas instantly
- **Offline-first** — everything runs locally after `npm install`

---

## Prerequisites

| Tool | Minimum version | Check |
|---|---|---|
| Node.js | 18 LTS (20 recommended) | `node --version` |
| npm | 9+ (bundled with Node) | `npm --version` |
| Git | any recent | `git --version` |

---

## Installation

### Option A — Clone and run (recommended)

```bash
git clone https://github.com/azzindani/Folio.git
cd Folio
npm ci
npm run build
npm run preview
```

Then open `http://localhost:4173` in your browser.

### Option B — Development mode (hot reload)

```bash
git clone https://github.com/azzindani/Folio.git
cd Folio
npm ci
npm run dev
```

Then open `http://localhost:5173`. Changes to `src/` reload the browser instantly.

### Option C — Google Colab (no local install needed)

Open [`folio_colab.ipynb`](folio_colab.ipynb) in Google Colab. Run each cell in order. The final cell gives you a public HTTPS URL to open Folio in your browser from anywhere.

> Free Colab instances disconnect after ~90 minutes of inactivity. Re-run from Cell 3 to resume.

---

## npm Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start hot-reload dev server on `:5173` |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built `dist/` on `:4173` |
| `npm run typecheck` | TypeScript strict type check (zero errors policy) |
| `npm run lint` | ESLint (zero warnings policy) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run test:unit` | Run unit tests with Vitest |
| `npm run test:integration` | Run integration tests |
| `npm run test:coverage` | Unit tests + V8 coverage report |
| `npm run test:e2e` | Playwright E2E tests (requires built `dist/`) |
| `npm run test:bench` | Performance benchmarks |
| `npm run clean` | Remove `dist/`, `node_modules/`, `.vite/` |

---

## Using the Editor

### Opening a design

1. Click **Open** in the Files panel (left sidebar) — opens a file picker
2. Select any `.design.yaml` or `.yaml` file
3. The canvas renders immediately

### Creating a design

The editor loads a sample design on startup. To start fresh:

1. Switch to **Payload** mode (toolbar center toggle or `Ctrl+K` → "open payload")
2. Replace the YAML with your own design spec (see format below)
3. Switch back to **Visual** mode

### Editing visually

- **Click** a layer to select it — handles appear
- **Drag** to move the layer
- **Drag handles** to resize
- **Shift+click** to add to selection
- **Double-click** a layer name in the panel to rename it
- **Properties panel** (right sidebar) shows editable fields for the selected layer

### Editing YAML directly

Click **Payload** in the toolbar center to open the Monaco editor. Any valid YAML edit re-renders the canvas within milliseconds. Validation errors appear inline and in the Problems panel.

### Saving

Click **Save** in the Files panel or press `Ctrl+S`. On browsers that support the File System Access API (Chrome/Edge desktop), saves overwrite the original file. Other browsers download a copy.

### Exporting

Click **Export** in the top-right toolbar:

| Format | Notes |
|---|---|
| SVG | Vector, lossless, opens in any browser |
| PNG ×2 | 2160×2160 px — retina quality |
| PDF | Client-side via jsPDF |
| HTML | Self-contained — fonts, images, and design YAML all embedded |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `T` | Text tool |
| `L` | Line tool |
| `G` | Toggle grid |
| `Ctrl+K` or `/` | Command palette |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+D` | Duplicate selected layer(s) |
| `Ctrl+C` | Copy selected layer(s) as YAML |
| `Ctrl+V` | Paste YAML layer(s) |
| `Ctrl+G` | Group selected layers |
| `Ctrl+Shift+G` | Ungroup |
| `Ctrl+[` | Send backward |
| `Ctrl+]` | Bring forward |
| `Ctrl+0` | Fit canvas to screen |
| `Ctrl+S` | Save file |
| `Ctrl+O` | Open file |
| `Delete` / `Backspace` | Delete selected layer(s) |
| `Escape` | Deselect all |

---

## Design File Format

Designs are plain YAML stored as `*.design.yaml`:

```yaml
_protocol: "design/v1"
_mode: complete

meta:
  id: my-poster
  name: My Poster
  type: poster          # poster | carousel
  created: "2026-04-10"
  modified: "2026-04-10"
  generator: human      # human | llm

document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96

theme:
  ref: dark-tech        # dark-tech | light-clean | ocean-blue

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
    y: 400
    width: 920
    height: auto
    content:
      type: plain
      value: "Hello, Folio!"
    style:
      font_family: "$heading"
      font_size: 80
      font_weight: 800
      color: "$text"
      line_height: 1.1
```

### Layer types

| type | Description |
|---|---|
| `rect` | Rectangle with fill, stroke, radius, shadow |
| `circle` | Circle or ellipse |
| `text` | Text block (plain, markdown, rich with spans) |
| `line` | Straight line |
| `path` | SVG bezier path |
| `icon` | Lucide icon by name |
| `image` | Raster or SVG image |
| `group` | Layer group with children |
| `mermaid` | Mermaid diagram DSL |
| `chart` | Vega-Lite JSON spec |
| `code` | Syntax-highlighted code block |
| `math` | KaTeX math expression |
| `component` | Reusable component instance |

### Z-index bands

```
0–9    Background   — colors, textures, full-bleed shapes
10–19  Structural   — cards, containers, layout frames
20–49  Content      — text, icons, images, charts
50–69  Overlay      — decorative overlays, color washes
70–89  Foreground   — accent shapes, highlights
90–99  UI           — editor-only selection handles (never in files)
```

Use banded values (e.g. `z: 20`, `z: 21`) rather than sequential integers so layers can be inserted without renumbering.

### Theme tokens

Prefix any color or font value with `$` to reference the active theme:

```yaml
color: "$primary"        # → theme.colors.primary
font_family: "$heading"  # → theme.typography.families.heading
color: "$text_muted"     # → theme.colors.text_muted
```

### Fill types

```yaml
fill: { type: solid, color: "$primary" }
fill: { type: linear, angle: 135, stops: [{color: "#1A1A2E", position: 0}, {color: "#16213E", position: 100}] }
fill: { type: radial, cx: 50, cy: 50, radius: 70, stops: [...] }
fill: { type: none }
```

---

## Built-in Themes

| Theme ID | Description |
|---|---|
| `dark-tech` | Dark indigo/red — bold, technical aesthetic |
| `light-clean` | White/blue — clean, professional |
| `ocean-blue` | Deep ocean blue — calm, modern |

Switch theme via the dropdown in the top-right toolbar, or set `theme.ref` in your YAML.

---

## Project Structure

```
src/
  editor/         — app bootstrap, state manager, canvas, keyboard
  renderer/       — SVG layer renderers (rect, text, circle, etc.)
  schema/         — YAML parser, validator, token resolver
  themes/         — built-in theme definitions
  export/         — PNG, SVG, PDF, HTML exporters
  fs/             — File System Access API + fallback
  ui/
    toolbar/      — top toolbar (mode toggle, zoom, export)
    panels/       — file tree, layer panel, properties panel
    tools/        — toolbox, align toolbar
    palette/      — command palette
  utils/          — toast notifications, debug logger

tests/
  e2e/            — Playwright end-to-end tests
  fixtures/       — sample .design.yaml files used by tests
  visual/         — Playwright visual regression snapshots
```

---

## Running Tests

```bash
# Unit + integration tests
npm run test:unit

# Unit tests with coverage report
npm run test:coverage

# E2E tests (build first — tests run against dist/)
npm run build
npm run test:e2e

# E2E for a single browser
npx playwright test --project=chromium

# Performance benchmarks
npm run test:bench
```

---

## Google Colab Quick Start

1. Go to [colab.research.google.com](https://colab.research.google.com)
2. Upload or open `folio_colab.ipynb` from this repo
3. Run **Cell 1** — installs Node.js 20
4. Run **Cell 2** — clones the repo
5. Run **Cell 3** — installs npm dependencies (~60–90 seconds)
6. Run **Cell 4** — builds the production bundle (~15–30 seconds)
7. Run **Cell 6** — starts the server and prints a public URL

Click the printed URL to open Folio in your browser. You may see a "tunnel password" page — click **Click to continue**.

If Cell 6 (localtunnel) is unreliable, run **Cell 6b** instead (cloudflared tunnel — more stable).

---

## Architecture Overview

```
.design.yaml file
      │
      ▼
  YAML Parser (js-yaml)
      │
      ▼
  Schema Validator         ← reports errors to Problems panel
      │
      ▼
  Token Resolver           ← $primary → #E94560 (from active theme)
      │
      ▼
  SVG Renderer             ← one renderer per layer type
      │
      ▼
  Canvas (SVG-in-HTML)     ← interact.js handles drag/resize
      │
      ├── Monaco Editor    ← bidirectional: YAML ↔ state
      └── Export Pipeline  ← PNG / SVG / PDF / HTML
```

The design file is the source of truth. The canvas is a live view. The Monaco editor is a live view of the same state. Editing either one updates the other.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes with tests
4. Ensure CI passes: `npm run typecheck && npm run lint && npm run test:unit`
5. Open a pull request

All PRs must pass:
- TypeScript strict mode (zero errors)
- ESLint (zero warnings)
- Unit test coverage targets
- No bundle size regression > 5%

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| Phase 1 | Active | Editor + Engine (current) |
| Phase 2 | Planned | MCP server — LLM tool surface via stdio |
| Phase 3 | Future | Animation — CSS/keyframe, GIF/MP4 export |

---

## License

MIT
