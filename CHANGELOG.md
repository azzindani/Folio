# Changelog

## [Unreleased]

## [0.2.0] - 2026-07-11

Editor power tools + export fidelity + engine reach. Second release: the visual
editor gains pin constraints, on-canvas gradient handles, pattern/image fill
controls, path booleans, and SVG-import-to-layers; PPTX and the editor-button
PDF now carry native selectable text; the MCP engine adds project fonts, catalog
packs, photo treatments, model-facing asset intelligence, and print-finish
patterns; plus asset round-trip + FAIL-cluster regression suites.

### Editor

- **Editor rescue batch** — tablet 768–1023px layout fixed (overlay panels
  default-collapsed, no horizontal scroll, no panel sliver over the canvas);
  right-click canvas context menu (duplicate/copy/paste/group/z-order/flip/
  lock/delete) backed by shared `layer-actions.ts`; multi-select properties
  panel (bounds, group/ungroup, align/distribute grid); project **Assets
  panel** in the left rail (click inserts the image at native aspect);
  ≥40px touch targets.
- **Real-phone crop fixed** — `viewport-fit=cover` + `100dvh` + safe-area
  padding on the bottom bars; collapse grid templates media-scoped so
  portrait phones get the full-width canvas (was a 48px sliver).
- **Multipage audit fixes** — stale "Page" row in the properties panel,
  page strip hidden under the mobile nav, parked tablet panel sliver,
  missing layer-type icons; page switch / thrash / add / duplicate /
  delete / undo / presentation verified live with gradient defs intact.
- **Monoline chrome icons** — every emoji in the editor UI replaced with a
  shared stroke-SVG set on `currentColor` (`editor/chrome-icons.ts`);
  page-strip thumbnails use the chrome surface instead of hard-coded white.
- **Catalog lazy-loaded** — main entry 512KB → ~488KB (budget enforced in CI).
- **Pin constraints (responsive resize)** — L/T/R/B pin toggles in the
  properties panel; resizing the document holds each pinned layer's edge
  offset (both opposing edges → the layer stretches; unpinned axes float
  proportionally). Pure `editor/pin-constraints.ts`, applied on canvas resize.
- **Project fonts in the editor** — an uploaded TTF/OTF now loads via the
  FontFace API so the live canvas matches PNG/PDF export.
- **Editor-button vector PDF** — the in-editor PDF export now produces true
  selectable vector text (embedded TrueType) by fetching the bundled fonts from
  `/fonts` (copied into `dist/fonts` at build, served by the static-server),
  matching the MCP server's PDF. Falls back to raster + invisible selectable
  text when fonts are unreachable.
- **PPTX editable text** — exported slides now carry native, selectable/editable
  text boxes over the pixel-faithful background image (was image-only). Text with
  a solid-hex colour and no rotation/effect is promoted and hidden from the
  raster so nothing draws twice; effect-heavy or token-coloured text stays baked
  in — the slide always looks identical.
- **SVG import → editable layers** — "Import SVG as Layers…" turns a Figma/
  Illustrator SVG into native rect/ellipse/line/polygon/path/text layers, with
  each element's transform baked into absolute coordinates so it round-trips to
  export (`editor/svg-import.ts` + affine path transformer).
- **Path booleans** — Union / Subtract / Intersect / Exclude two selected
  shapes into one new `path` layer (`editor/boolean-ops.ts`, bundled
  `polygon-clipping`, lazy-loaded — no runtime CDN). Renders identically in the
  editor and resvg export.
- **Gradient handles + pattern/image fill controls** — a selected gradient
  layer shows draggable axis handles on the canvas (linear endpoints → angle,
  radial center + radius); new Pattern and Image fill tabs in the properties
  panel write the exact fill spec the MCP emits, so panel-authored fills
  round-trip to export.

### Engine

- **Height-0 shorthand text is containable** — blind-model text (no height)
  had zero box area, so the containment test never fired and a card ejected
  its own label/body at seal; text height is now measured before the test.
- **Idempotent re-seal reporting** — no more phantom "Re-lit 1" when relight
  caps out at the text's current color; a no-op stays silent.
- **Seal-time dedupe** (`engine-finalize-dedupe.ts`) — repeated section
  thrash (identical text signatures at any depth, stacked echoes, repeated
  images) collapses to first-in-flow + gap compaction; scroll-ratio posters
  get a carousel hint.
- **Project fonts** — a TTF/OTF uploaded to `<project>/assets/fonts` now
  renders everywhere: live editor (FontFace off the project-files mount),
  PNG (resvg reads the project dir), and selectable text in the vector PDF
  (jsPDF embeds the project file). `resvgFontOption`/`unbundledFonts`/`pickFont`
  take an optional project dir; the unbundled-font warning recognizes project
  families. Shared pure `utils/font-name.ts` (filename→family/weight).
- **Catalog packs over MCP** — `themes {op:"packs"}` exposes the editor's
  curated colour PALETTES, TYPE pairings, and EFFECTS sets read-only: name a
  pack, get usable hexes / heading·body·mono families / effect keys (a single
  pack is ≤100 tokens). No new tool, no project needed.
- **Print-finish patterns** — `newsprint`, `riso`, `engraving`, `mezzotint`
  join the pattern-fill vocabulary: deterministic, seamless-tileable,
  resvg-safe hand-printed grain for less-templated, more-editorial fields.

### Branding

- **Folio tab icon on every HTML surface** (`utils/favicon.ts`, inline
  data-URI): /library gallery, exported gallery/report/presentation/print/
  animation HTML, design HTML exports, OAuth + token pages — previously
  only the editor had it.

## [0.1.0] - 2026-06-28

First public release of Folio — a local-first, LLM-first YAML graphic-design
engine. A model writes semantic shorthand YAML; the engine compiles it to SVG
and makes it render well; a visual editor and an MCP tool surface sit on top.
Consolidates the internal Phase 1–5 work (full history under [1.0.0] below).

### Design engine + MCP

- **MCP server — 21 op-multiplexed tools** over Streamable-HTTP. The hot
  core-loop tools (create_design, add_layers, patch_design, seal_design,
  append_page, render_preview, diagnose_design, export_design) stay first-class;
  the long tail folds into 8 `op`-routed tools — `manage_design`, `themes`,
  `tasks`, `edit_layer`, `templates`, `report`, `presentation`, `animation` — so
  models stop fixating on a few and the rest stays discoverable. **No capability
  removed**: every former tool maps to one `op`, and forward hints are remapped
  so a model that follows one always lands on a tool that exists. Deployed at
  folio.casava.space (Docker, `bun --smol`, no build step).
- **Built-in template catalog over MCP** — `templates {op:list}` browses the 432
  editor-catalog templates and `{op:inject}` fills one by id, so a model can use
  the same templates a human browses (those assets were previously unreachable
  from the tool surface).
- **Model-led, math-backed generation** — the engine validates spatial math,
  expands shorthand, fits/clamps to canvas, and heals blind-model payloads at
  seal (geometry, legibility, auto-place, page balance) without dictating the
  look. The model designs; the engine makes it render well.
- **Streamable-HTTP compliance** so strict MCP-SDK clients (LM Studio, Claude
  Desktop / Code, claude.ai custom connector) connect cleanly — OAuth + PKCE
  plus HS256-JWT / API-key auth, with a stdio fallback via `mcp-remote`.
- **Per-client rate limiting** on POST /mcp (token-bucket, 429 + Retry-After)
  guarding the single-threaded server.
- **Reference-image → design** — `extract_reference` turns a Canva export,
  screenshot, or SVG into a deterministic role-mapped palette + recommended
  canvas + a composition brief the model fills by looking at the image
  (header-only parse of PNG/JPEG/GIF/WebP/SVG — no pixel decode, no new deps).
- **Exports** — PNG, self-contained HTML, interactive HTML reports, and a
  hybrid **vector PDF** (selectable text over a raster fallback).

### Visual editor

- SVG canvas: zoom/pan, drag, shift-click multi-select, resize/rotate, inline
  text editing.
- **Alignment & anchoring** — smart guides + snap to other layers' edges and
  centres, seeing siblings nested inside grouped (preset) posters.
- **Design operations** — New blank design; canvas resize with aspect-ratio
  presets (1:1, 4:5, 3:4, 2:3, 9:16, 16:9); multi-page support with a thumbnail
  page strip to add / duplicate / delete / reorder pages from any design.
- **Server-backed auto-save + Save to Library** — a design opened from the MCP
  or library auto-saves back every 30s and on Ctrl+S; a brand-new design saves
  into the library.
- Theme / palette / type / effects pickers, command palette, keyboard
  shortcuts, layer + properties + problems panels, and a cross-project design
  **library gallery** (browse, thumbnails, search, editor links).
- **Reference underlay** — Shift-drop an image to add a locked, dimmed tracing
  layer (`ImageLayer.role: 'reference'`) and seed the palette from it; build
  native layers on top, then hide/remove before exporting.

### CI/CD

- Release pipeline publishes a Docker image to GitHub Container Registry
  (`ghcr.io/<owner>/folio:<version>` + `:latest`) and per-platform tarballs
  (linux / mac / windows) on every `v*.*.*` tag.

## [1.0.0] - 2026-04-09

### Added

#### Phase 1 — Editor + Engine
- Full type system: 15 layer types, 6 fill types, themes, components, templates, project manifests
- YAML parser/serializer with `js-yaml` (full Unicode, comments support)
- Schema validator: required fields, duplicate IDs, z-index conflicts, fill types, pos array length, type-specific checks
- Token resolver: `$token` syntax against theme colors/typography/effects/radii with deep nested search and override support
- SVG renderer: all layer types (rect, circle, path, polygon, line, text, image, icon, mermaid, chart, code, math, group) with gradient fills (linear, radial, conic, multi), SVG filters (drop-shadow, blur), noise overlays, effects pipeline
- Render cache with dirty tracking (JSON hash per layer)
- Grid overlay (column guides, baseline grid, center crosshair)
- Component system: `{{prop}}` slot resolution, template system with required/optional slots
- Component rendering integrated into main render pipeline with registry lookup
- Markdown text rendering via marked.js (lazy loaded)
- Monaco editor integration with bidirectional YAML<->canvas live sync, inline error markers
- Editor state manager with immutable undo/redo stack (100 levels)
- Canvas: zoom, pan, drag, pointer events, shift-click multi-select
- interact.js: drag-to-move, resize handles (NW/NE/SW/SE), snap-to-grid
- Alignment tools: left, right, top, bottom, center-h, center-v, distribute-h, distribute-v
- Command palette (/ shortcut) with 30+ searchable commands
- Keyboard shortcuts: undo, redo, delete, duplicate, z-order, zoom, grid toggle
- Layer panel: z-band grouped, collapsible, type icons
- Properties panel: context-aware per layer type (rect, circle, text, line)
- Page strip: carousel page navigation, thumbnails, add page
- Problems panel: live validation error display with severity indicators
- Export pipeline: SVG, PNG (canvas API, 2x scale), self-contained HTML
- File system access: File System Access API with `<input>` fallback
- CSS variables design token system for editor UI
- Responsive layout (desktop, tablet, mobile breakpoints)

#### Phase 2 — MCP Server
- Stdio transport MCP server with JSON-RPC 2.0 protocol
- 11 tools: create_project, list_designs, create_design, append_page, patch_design, seal_design, add_layer, update_layer, remove_layer, list_themes, export_design
- Full tool registry with inputSchema definitions for LLM tool-use
- Semantic shorthand parser (Level 2 compact YAML -> full verbose expansion)
- Context compression for local LLM token budget optimization
- Dot-path selector patching with array index notation (`pages[id=page_1].slots.title`)
- Incremental carousel generation protocol (create -> append -> seal)
- Resumable generation state tracking in design meta

#### Phase 3 — Animation
- CSS animation generator: 15 enter types, 7 exit types, 7 loop types
- Stagger sequence generator with configurable inter-item delays
- Composite animations (enter + loop combined)
- Keyframe engine: N-keyframe interpolation, 5 easing functions, hex color interpolation
- PlaybackController: play/pause/stop/seek with requestAnimationFrame loop
- Animated HTML export with injected CSS animations

#### Testing & CI/CD
- 195 unit + integration tests across 12 test files
- Comprehensive integration tests: full poster workflow, carousel workflow, MCP create→append→seal
- Realistic YAML fixtures: full-poster (13 layers, all types), carousel-guide (3 pages), theme, component
- GitHub Actions CI: lint, typecheck, unit tests (multi-OS/Node matrix), integration tests, build, bundle size check, performance benchmarks
- Dev/prod Vite configuration with sourcemaps, minification control, environment defines

### Technical Decisions
- Vanilla TypeScript (no React/Vue) — own render loop, no VDOM overhead
- SVG-in-HTML as primary render target — vector native, exportable
- YAML source of truth with JSON runtime — comments + readability + fast parse
- Banded z-index system (0-9 bg, 10-19 structural, 20-49 content, 50-69 overlay, 70-89 foreground)
- `$token` for theme references, `{{prop}}` for component slot references
- Lazy loading for heavy renderers (Monaco, mermaid, vega-lite, KaTeX, Prism.js)
- Deterministic rendering: same YAML -> identical SVG output
- Offline-first: zero network requests after npm install
