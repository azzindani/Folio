# ARCHITECTURE.md — Folio Design Engine
# System Architecture Reference
# v1.0.0 | Updated 2026-04-12

---

## 1. SYSTEM OVERVIEW

Folio is a **local-first, file-based graphic design engine** with two usage surfaces:

1. **Browser editor** — visual WYSIWYG + Monaco YAML editor (bidirectional live sync)
2. **MCP server** — stdio tool surface for LLM-driven design generation

```
┌─────────────────���──────────────────────────────────────���───────┐
│                        USER SURFACES                           │
│                                                                │
│   Browser Editor (src/editor/)        MCP Server (src/mcp/)   │
│   Visual canvas + Monaco YAML         JSON-RPC 2.0 via stdio  │
└────────────────────────���─────────────────────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │          ENGINE CORE           │
              │  schema/ · engine/ · renderer/ │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │         FILE LAYER             │
              │   .design.yaml · .theme.yaml   │
              │   .component.yaml · project.yaml│
              └─────���─────────────────────────┘
```

---

## 2. DATA FLOW

### 2.1 Editor Flow (browser)

```
YAML file / user edit
        │
        ▼
  src/schema/parser.ts          parseDesign(yaml) → DesignSpec
        │
        ▼
  src/schema/validator.ts       validateDesignSpec() → ValidationError[]
        │
        ▼
  src/editor/state.ts           StateManager.set('design', spec)
        │
        ├─── src/ui/panels/*    Layer panel, properties, problems re-render
        │
        ▼
  src/engine/token-resolver.ts  resolveLayerTokens(layer, ctx) → Layer
  src/engine/shorthand-expander expandPositionShorthand(layer) → Layer
        │
        ▼
  src/renderer/renderer.ts      renderDesign(spec, options) → SVGSVGElement
        │
        ├─── fill-renderer.ts   applyFill() → linearGradient / feFilter / etc.
        ├─── effects-renderer.ts applyEffects() → SVG <filter>
        └─── layer-renderers.ts  renderRect/Text/Circle/… → SVGElement
                  │
                  ▼
        Render cache (dirty tracking by prop hash)
                  │
                  ▼
        canvas.svgContainer.innerHTML = svg
```

### 2.2 MCP Flow (LLM generation)

```
LLM tool call (JSON-RPC)
        │
        ▼
  src/mcp/server.ts             parse JSON-RPC, route to handler
        │
        ▼
  src/mcp/tool-handlers.ts      e.g. appendPage() / createDesign()
        │
        ├─── src/mcp/shorthand-parser.ts  expandShorthand(layer) → full Layer
        │
        ▼
  js-yaml.dump()                serialize DesignSpec → YAML
        │
        ▼
  fs.writeFileSync()            write to .design.yaml
        │
        ▼
  src/fs/file-watcher.ts        detects change → fires onChange callback
        │
        ▼
  editor reloads design         instant canvas update
```

### 2.3 Export Flow

```
EditorApp.exportSVG() / toolbar export button
        │
        ▼
  src/export/exporter.ts
        │
        ├── exportToSVG()       XMLSerializer.serializeToString(svg)
        ├── exportToPNG()       SVG → Blob → Image → Canvas → PNG blob
        ├── exportToPDF()       PNG per page → jsPDF (lazy loaded)
        └── exportToHTML()      SVG string + design JSON + animation CSS → .html
```

---

## 3. MODULE RESPONSIBILITIES

### 3.1 `src/schema/`

| File | Responsibility |
|---|---|
| `types.ts` | All TypeScript interfaces: Layer, DesignSpec, ThemeSpec, ComponentSpec, TemplateSpec, ProjectSpec, Fill types, TextContent, Effects, etc. |
| `parser.ts` | YAML ↔ DesignSpec serialization. ParseError with line/column info. |
| `validator.ts` | Schema validation: required fields, duplicate IDs, duplicate z-index, fill validation. Returns `ValidationError[]` with severity + dot-path. |

### 3.2 `src/engine/`

| File | Responsibility |
|---|---|
| `token-resolver.ts` | `$token` → theme value. Lookup order: overrides → colors → typography → effects → radii → deep search. Fallback: `#FF00FF`. Resolves fills, strokes, text styles, shadow colors recursively. |
| `component-resolver.ts` | `{{propName}}` → slot value substitution. Walks layer objects recursively. Validates required props. |
| `shorthand-expander.ts` | `pos: [x,y,w,h]` → `{x,y,width,height}`. Basic position shorthand only. |
| `performance.bench.ts` | Vitest bench benchmarks (not runtime). |

### 3.3 `src/renderer/`

| File | Responsibility |
|---|---|
| `renderer.ts` | Main pipeline: token resolution → shorthand expansion → z-sort → per-layer dispatch. Dirty tracking cache (prop hash → SVGElement). Grid overlay. `renderDesign` (poster) + `renderPage` (carousel page). |
| `layer-renderers.ts` | One function per layer type. All 13 types: rect, circle, path, polygon, line, text, image, icon, mermaid, chart, code, math, group. Lazy async loading for mermaid/vega/katex/prism. |
| `fill-renderer.ts` | `applyFill()` dispatcher. Creates SVG linearGradient, radialGradient (conic approx), feTurbulence noise, multi (recursive), solid color. |
| `effects-renderer.ts` | `applyEffects()` → SVG `<filter>` in `<defs>`. feDropShadow, feGaussianBlur, opacity attr, CSS mix-blend-mode. Filter bbox extended ±20% to prevent clipping. |
| `svg-utils.ts` | `createSVGElement<K>(tag, attrs)`, `createSVGRoot(w,h)`, `getOrCreateDefs(svg)`, `uniqueDefId(prefix)` — global counter, reset before each render pass. |

### 3.4 `src/editor/`

| File | Responsibility |
|---|---|
| `state.ts` | Central reactive state (design, theme, selection, zoom, pan, mode, grid, undo stack). `set()`, `batch()`, `subscribe()`, `undo()/redo()`, `getCurrentLayers()`, `updateLayer()`, `addLayer()`, `removeLayer()`. |
| `app.ts` | Bootstrap: builds DOM layout, instantiates all managers, loads default theme + sample design, wires file watcher. |
| `canvas.ts` | SVG container + selection overlay. Pointer events for select/drag/rotate. Wheel for zoom/pan. `fitToScreen()`. Smart guides on drag. |
| `interactions.ts` | interact.js: draggable (snap to grid + layer edges) + resizable (corner handles, min 10px). |
| `keyboard.ts` | All keyboard shortcuts: undo/redo, tools, selection ops, clipboard (YAML), group/ungroup, z-order. |
| `payload-editor.ts` | Monaco Editor (lazy CDN load). Two-way sync with 300ms debounce. Validation markers. |

### 3.5 `src/ui/`

| File | Responsibility |
|---|---|
| `toolbar/toolbar.ts` | Top bar: visual/payload toggle, theme selector, zoom display, export menu. |
| `panels/layer-panel.ts` | Layered by z-band. Virtual scroll (32px rows, ~20 DOM nodes). Click-to-select, shift-multi, double-click rename. |
| `panels/properties-panel.ts` | Context-aware per layer type: position, fill, stroke, radius, text style. Gradient stop editor (partial). |
| `panels/problems-panel.ts` | Validation error/warning list. Re-runs on every design change. |
| `panels/file-tree.ts` | FSA open/save, recent files (localStorage, max 8), current design info. |
| `panels/page-strip.ts` | Carousel page thumbnails. Click-to-navigate. Add page button. |
| `palette/command-palette.ts` | Cmd+K palette. 100+ commands. Filtered list, arrow keys, Enter/Esc. |
| `tools/align-toolbar.ts` | Alignment actions: left/center/right/top/middle/bottom, distribute H/V. |
| `tools/toolbox.ts` | Tool buttons: select, rect, circle, text, line. |

### 3.6 `src/mcp/`

| File | Responsibility |
|---|---|
| `server.ts` | JSON-RPC 2.0 stdio server. Routes: initialize, tools/list, tools/call. |
| `tool-handlers.ts` | All 16+ tool implementations: createProject, createDesign, appendPage, patchDesign, sealDesign, addLayer, updateLayer, removeLayer, listThemes, exportDesign, batchCreate, duplicateDesign, resumeDesign, saveAsComponent, applyTheme, listDesigns. |
| `shorthand-parser.ts` | Level 1-2 shorthand → full verbose Layer. Compact LLM notation → engine-ready spec. |
| `tool-registry.ts` | JSON schema definitions for all tools. Used in MCP initialize response. |
| `types.ts` | MCPRequest, MCPResponse, ToolCallResult, ToolDefinition. |

### 3.7 `src/export/`

| File | Responsibility |
|---|---|
| `exporter.ts` | exportToSVG, exportToPNG (canvas 2D, configurable scale), exportToPDF (jsPDF lazy, px→mm at 96dpi), exportToHTML (embedded SVG + design JSON + animation CSS), downloadBlob/downloadText. |

### 3.8 `src/animation/`

| File | Responsibility |
|---|---|
| `types.ts` | EnterAnimationType (14), ExitAnimationType (7), LoopAnimation (7), KeyframePoint, AnimationSpec, PlaybackConfig, StaggerSequence. |
| `css-generator.ts` | @keyframes rules + animation properties per layer. Stagger delay calculation. Full presets for all 28 animation types. |
| `keyframe-engine.ts` | Linear keyframe interpolation. Color lerp (hex→rgb→hex). PlaybackController with RAF loop. |

### 3.9 `src/fs/`

| File | Responsibility |
|---|---|
| `file-access.ts` | File System Access API + `<input>` fallback. openFile(), saveFile(). |
| `file-watcher.ts` | Polls watched FileSystemFileHandle. Fires onChange(name, content) on modification. |

### 3.10 `src/themes/`

`builtin.ts` — 3 built-in themes: `dark-tech`, `light-clean`, `ocean-blue`. Each has full color palette, typography scale, spacing, effects, radii.

---

## 4. STATE MANAGEMENT

### 4.1 StateManager (`src/editor/state.ts`)

Single source of truth for all editor state. Observer pattern — all UI components subscribe and react to key changes.

```typescript
interface EditorState {
  design: DesignSpec | null      // current open design
  theme: ThemeSpec | null        // resolved active theme
  selectedLayerIds: string[]     // active selection
  zoom: number                   // canvas zoom (0.1–5)
  panX: number                   // canvas pan X
  panY: number                   // canvas pan Y
  mode: 'visual' | 'payload'     // editor mode
  currentPageIndex: number       // active carousel page
  gridVisible: boolean           // grid overlay toggle
  yamlSource: string             // raw YAML string (Monaco)
  dirty: boolean                 // unsaved changes
  activeTool: ToolId             // select|text|rect|circle|line
}
```

**Undo/redo:** Immutable stack, max 100 entries. Every `set()` call with `recordUndo=true` (default) pushes previous state.

**Batch updates:** `state.batch(fn)` runs multiple sets, fires single notification.

**Layer operations:** `updateLayer(id, updates)` recursively walks design.layers and page.layers, including group children. Both poster and carousel modes supported.

### 4.2 Component Communication Pattern

```
StateManager (source of truth)
      │
      ├── CanvasManager.onStateChange()     → re-render SVG
      ├── LayerPanelManager.onStateChange() → rebuild virtual list
      ├── PropertiesPanelManager            → update fields
      ├── ProblemsPanelManager              → re-validate
      ├── PayloadEditor                     → sync Monaco content
      ├── PageStrip                         → rebuild page list
      └── ToolbarManager                   → update mode/zoom display
```

No circular updates: Monaco sync uses guards (`isUpdatingFromState`, `isUpdatingFromEditor`).

---

## 5. RENDER PIPELINE DETAILS

### 5.1 Dirty Tracking Cache

```typescript
const renderCache = new Map<string, { hash: string; svg: SVGElement }>()

// Per-render:
const layerHash = JSON.stringify(layer)        // full prop hash
const cached = renderCache.get(layer.id)
if (cached && cached.hash === layerHash) {
  return cached.svg.cloneNode(true)            // ~0.1ms — cache hit
}
// else: full render (~0.1ms–50ms per type), store result
```

Cache invalidated on: theme change, zoom change, canvas resize (full clear). Single layer change: only that layer re-renders.

### 5.2 Layer Render Order

```
For each render pass:
  1. expandPositionShorthand(layer)         pos:[x,y,w,h] → explicit
  2. resolveLayerTokens(layer, ctx)         $token → hex/value
  3. sort by z ascending
  4. renderLayer(layer, svg) per layer
     └── check cache → uncached → dispatch to type renderer
```

### 5.3 Async Renderers (lazy loaded)

Mermaid, vega-lite, katex, prism — loaded on first use via dynamic import. While loading: foreignObject placeholder text shown. On load: re-render.

```typescript
// Pattern:
const container = createForeignObject(x, y, w, h)
const placeholder = document.createElement('div')
placeholder.textContent = layer.definition  // shown immediately
container.appendChild(placeholder)

import('mermaid').then(({ default: mermaid }) => {
  mermaid.render(id, layer.definition).then(({ svg }) => {
    placeholder.innerHTML = svg  // replace with rendered output
  })
})
```

### 5.4 Performance Targets

```
rect / circle / line:    ~0.1ms   pure SVG attrs
text (plain):            ~0.3ms   SVG text + line wrapping
text (markdown):         ~2ms     marked.js parse
icon (placeholder):      ~0.2ms   placeholder rect+text
image:                   ~5ms     decode + embed
mermaid (first):         ~50ms    → cache SVG
vega-lite (first):       ~30ms    → cache SVG
katex (first):           ~5ms     → cache
code/prism (first):      ~3ms     → cache
```

---

## 6. MCP SERVER ARCHITECTURE

### 6.1 Protocol

```
Transport: stdin/stdout (stdio)
Protocol:  JSON-RPC 2.0
Messages:  newline-delimited JSON

Flow:
  Client → initialize       → capabilities response
  Client → notifications/initialized
  Client → tools/list       → array of tool definitions
  Client → tools/call       → { name, arguments } → { content: [{type,text}] }
```

### 6.2 Tool Architecture

```
server.ts  →  tool-registry.ts    (metadata/schema per tool)
           →  tool-handlers.ts    (implementation)
                    │
                    ├── readYAML()    fs.readFileSync → yaml.load
                    ├── writeYAML()   yaml.dump → fs.writeFileSync
                    └── expandShorthand() via shorthand-parser.ts
```

All tools are synchronous file operations except exportDesign (async render pipeline).

### 6.3 Shorthand Levels

```
Level 1 — Slot fill (LLM):        template + slots → ~50-150 tokens/design
Level 2 — Semantic shorthand:     compact layer spec → ~300-600 tokens/design
Level 3 — Full verbose YAML:      on disk (engine-generated) → 2000-4000 tokens
```

`shorthand-parser.ts` expands Level 1-2 to Level 3 before writing to disk.

### 6.4 Incremental Generation

```
State tracked in meta.generation:
  status: 'in_progress' | 'complete'
  total_pages: N
  completed_pages: N
  last_operation: string

resumeDesign(id): reads completed_pages → returns context for next page
sealDesign(id):   sets _mode: 'complete', generation.status: 'complete'
```

---

## 7. FILE SYSTEM ABSTRACTION

### 7.1 Browser (editor)

```
Desktop Chrome:  File System Access API (FileSystemFileHandle)
                 → read/write files, watch for changes
Other browsers:  <input type="file"> + download via blob URL
                 → no file watching (no-op)

Abstraction (src/fs/):
  openFile(accept) → {name, content} or null
  saveFile(content, filename) → download or FSA write
  watchFile(handle, initialContent) → polls handle, fires onChange()
  isNativeFS() → true only on Chrome with FSA support
```

### 7.2 MCP Server (Node.js)

Direct `fs` module — `readFileSync`, `writeFileSync`, `mkdirSync`. No abstraction needed — server runs in Node.js, not browser.

---

## 8. TEST ARCHITECTURE

### 8.1 Stack

```
Vitest         unit + integration (Vite-native, jsdom environment)
Playwright     E2E (real browser: Chromium/Firefox/WebKit)
               visual regression (screenshot comparison, ≤1% diff)
```

### 8.2 Unit Test Layout

```
src/*/                    ← co-located .test.ts files
tests/
  e2e/                    ← Playwright E2E specs
  integration/            ← full workflow tests (Vitest, no browser)
  visual/                 ← Playwright visual regression
  fixtures/               ← sample .design.yaml, .theme.yaml
```

### 8.3 Coverage Targets

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

### 8.4 Key Test Invariants

```
Renderer determinism:  same YAML → identical SVG on repeated calls
Token resolution:      $primary → correct hex, overrides take precedence
Undo/redo:             state returns to exact previous value
Export:                HTML output has no external URLs (self-contained)
MCP round-trip:        create → append → seal produces valid .design.yaml
```

---

## 9. BUILD PIPELINE

### 9.1 Commands

```bash
npm run dev          # Vite dev server (HMR)
npm run build        # tsc --noEmit + vite build → dist/
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint --max-warnings 0
npm run test:unit    # vitest run (unit tests)
npm run test:e2e     # playwright test tests/e2e/
npm run test:visual  # playwright test tests/visual/
npm run test:bench   # vitest bench (performance)
npm run mcp          # node dist/mcp-server.js (stdio server)
```

### 9.2 Bundle Strategy

```
Initial bundle (~500KB gzipped):
  SVG renderer · text renderer · icon placeholder
  token resolver · shorthand expander
  marked.js (~20KB) · js-yaml (~45KB)
  interact.js (~30KB) · Floating UI (~15KB)
  Lucide sprite (~150KB)

Lazy chunks (loaded on first use):
  Monaco Editor    ~2MB   (payload mode activate)
  mermaid          ~500KB (first mermaid layer)
  vega-embed       ~400KB (first chart layer)
  katex            ~280KB (first math layer)
  prismjs          ~30KB  (first code layer)
  jsPDF            ~200KB (PDF export)
  dom-to-image-more ~20KB (PNG export)
```

### 9.3 Offline-First Rule

Zero CDN calls at runtime after `npm install`. All assets bundled locally. No `fonts.googleapis.com`, no `unpkg.com`, no external URLs.

---

## 10. KNOWN GAPS & NEXT STEPS

### 10.1 Icon Layer (High Priority)

Current: renders placeholder rect + text with icon name.
Required: bundle Lucide SVG sprite at build time, resolve name → SVG path data.

```typescript
// Target implementation:
import { icons } from 'lucide'  // or lazy load sprite
export function renderIcon(layer: IconLayer, svg: SVGSVGElement): SVGElement {
  const paths = icons[layer.name]  // get path data
  const el = createSVGElement('svg', { width: layer.size, height: layer.size })
  // render paths...
}
```

### 10.2 Per-Corner Border Radius (Medium Priority)

SVG `<rect>` only supports uniform `rx`. For independent corners, use `<path>` with arc commands.

### 10.3 Properties Panel Gradient Editor (Medium Priority)

Basic gradient rendering works. Full interactive gradient stop editor (drag stops, color picker per stop) is stubbed.

### 10.4 Mode B Interactive Output (Phase 2)

State/data binding/scripting layer not implemented. Requires: TS compiler integration, sandbox iframe, state runtime.

### 10.5 Phase 3 Exports (Phase 3)

GIF, MP4/WebM (Puppeteer frame capture + FFmpeg), Lottie JSON — not yet implemented.

### 10.6 node_modules (Immediate)

`npm install` not run in this environment. Required before any test or build.
