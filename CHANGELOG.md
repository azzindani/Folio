# Changelog

## [Unreleased]

Motion you can direct, and pixels you can push — the After Effects and Photoshop layers.

### Added

- **Keyframe engine v2** (`src/animation/easing.ts`, `keyframe-css.ts`) — 30+ easing
  curves (Penner family, back/elastic/bounce, `cubic-bezier`, `steps`), per-keyframe
  `easing` and `hold`, new channels `scale_x scale_y skew_x skew_y blur draw`,
  `playback.anchor` (pivot) and `iterations`. Curves CSS cannot express are baked
  into sub-steps so the animated SVG and the GIF flipbook agree. A stroke reveal
  (`draw` 0→1) gets `pathLength="1"` injected at export.
- **28 motion presets** — entrances `pop drop blur_in draw_on spin_in flip_in grow_up whip`,
  exits `fade_out sink shrink_out blur_out sweep_out pop_out`, loops `wobble sway
  heartbeat flicker` join the original ten.
- **`animation(op:sequence)`** — a whole scene in one call: ordered steps of presets on
  layers with `at`/`stagger_ms`; entrance + exit on one layer fold into one track.
  **`op:track`** writes raw validated keyframes; **`op:frame`** renders the pose at time
  *t* as a PNG attachment with resolved geometry; **`op:timeline`** is now a Gantt with
  `scene_ms`; **`op:clear`**, **`op:presets`**. Guide section `motion`.
- **Pixel pipeline** (`src/utils/image-adjust.ts`, `image-geometry.ts`, `image-filters.ts`) —
  brightness/contrast/exposure/gamma/levels, saturation/hue/invert/sepia/duotone/tint/
  posterize/threshold, crop (box/aspect)/trim/rotate/flip, gaussian blur/unsharp
  mask/vignette/grain, rounded corners/pad/flatten. All pure TS over the PNG codec.
- **`manage_design(op:asset_process)`** — run a recipe on a stored asset (project or
  `lib/`) into a new asset, non-destructively; `asset_add.process` accepts the same
  recipe. See `docs/MOTION.md`.

### Changed

- `generateKeyframeCSS` now always emits an explicit 0% frame and per-step
  `animation-timing-function`; the shorthand runs `linear` and the curve lives on the
  steps. `transform-origin` follows `playback.anchor` (default `50% 50%`).
- `interpolateKeyframes` tweens a channel first named in a later frame from its last
  known value instead of jumping.

## [Unreleased — earlier]

Motion you can actually get out, and a print PDF that is the size you asked for.

### Added

- **Binary-free motion export** — `animation(op:export)` gains `type:"svg"` and
  `type:"html"`, which write a real animated file in-process with no extra
  software:

  ```
  animation(op:export, design_path:…, type:"svg")
  → 686 bytes, vector, animated, no ffmpeg and no Chromium involved
  ```

  The renderer already tags every layer with `data-layer-id` and the CSS
  generator already emits `@keyframes` against those selectors, so an animated
  SVG needs only a `<style>` block inlined into the render — no frame capture
  and no encoder. `type:"html"` wraps the same SVG in a shareable single file
  that honors `prefers-reduced-motion`.

- **`generateKeyframeCSS`** (`src/animation/css-generator.ts`) — keyframe
  timelines now produce motion. `layer.animation.keyframes` had no consumer at
  all, so every timeline written by `animation(op:keyframe)` rendered
  completely static. Positions emit as a delta from the first frame (the
  renderer already places the layer, so absolute values would double the
  offset), and `transform-box: fill-box` makes rotation and scale turn about
  the layer's own centre rather than the SVG root origin.

- **`encoder: 'auto' | 'ffmpeg' | 'none'`** on `AnimationExportOptions` — a
  caller that needs a real video can demand one and get a hard error instead of
  a silent downgrade, and a caller that only wants frames need not shell out.

- **`animation(op:motion)`** — apply a motion preset across layers in one call
  instead of one call per layer per keyframe (a six-item stagger was
  twenty-four):

  ```
  animation(op:"motion", preset:"rise", layer_ids:["l1","l2","l3"], stagger_ms:120)
  ```

  Entrances (`fade_in`, `rise`, `settle`, `scale_in`, `sweep_in`) and loops
  (`pulse`, `float`, `spin`, `drift`, `breathe`). These are mechanics, not
  looks — none decides layout, colour, hierarchy or composition — and what they
  write is ordinary keyframes, so `op:timeline` shows them and `op:keyframe`
  overrides any single one. A locked group is one target and is not broken
  apart. MCP tools remain 21.

- **`process:` on `manage_design(op:asset_add)`** — `{remove_bg:true}` cuts a
  flat backdrop out of a PNG so a logo or product shot sits on any canvas
  colour, `{fit:{w,h,mode}}` resamples. Background removal existed but was
  browser-bound to the editor panel and unreachable from MCP. No new tool and
  no new op — the operation is still "put this image in the project".

- **Mark geometry in `diagnose_design`** — for a design shaped like an identity
  mark (single page, roughly square, <=800px, <=8 layers) the result carries a
  `mark` block: optical centre (centroid of ink vs bounding box, with the
  direction to nudge), scale survival at 16/24/32/64/128/512px, contrast against
  white/black/mid-grey, and a clearspace rule in the mark's own units. Plus
  `get_engine_guide(section:"marks")`. The engine MEASURES a mark you drew; it
  never generates one — preset marks are why AI logos all look alike.

- **`animation(op:export, type:"gif")` works with no ffmpeg** — frames rendered
  through resvg, median-cut quantized, LZW-encoded in-process. Verified on the
  container: 1080x1080, 14 frames, 303 KB, decoded frame-by-frame with Pillow.

- **Pure-TypeScript PNG codec** (`src/utils/png-codec.ts`) and
  **`bg-remove-core.ts`** — no `canvas`, no `sharp`, nothing needing a native
  build in a `bun --smol` container. The editor and the server now run one
  background-removal implementation instead of two.

### Changed

- **`document.dpi`, motion presets and image processing all landed without a
  new tool.** The surface is still exactly 21 tools, per `docs/ROADMAP.md`
  ground rule 1.

- **`docs/UX_ROADMAP.md` and `docs/ROADMAP.md` corrected.** Row 12.5 recorded
  GIF/MP4/WebM export as shipped throughout the period the tool produced no
  file, and WP-1.1/1.2/1.3/3.2 still read as open months after shipping.

### Fixed

- **Animated SVG/HTML/GIF exports shipped with missing images.** These routes
  called the renderer directly and skipped the asset resolution `export_design`
  has always done, so the file went out carrying `src="assets/images/logo.png"` —
  a path that resolves to nothing once it leaves the project directory. The
  export reported success and the image was simply absent.

- **A GIF of an `alternate` loop snapped on repeat.** Only the outward leg was
  exported, so a pulse ended mid-swell — a visible jolt each cycle the CSS
  version never has.

- **Mark legibility was judged on colour variety**, so a bold one-colour
  silhouette — the mark most likely to survive anywhere — was reported
  illegible while busy marks passed. Rebased on coverage retention.

- **Clearspace read a solid disc's diameter as a stroke width**, advising 696px
  of padding for a 400px mark on a 512px canvas.

- **`animation(op:keyframe)` could not reach any layer in a carousel.** Every
  page this engine authors is one locked group, and the walk was top-level
  only — so it returned "Layer not found" for ids that were plainly there, and
  the whole keyframe API was unreachable on the engine's own output.
  `inspectTimeline` had the matching half: `buildTimelineTracks` takes a flat
  array, so it reported zero tracks for those same designs.

- **Entrances finished displaced.** `generateKeyframeCSS` treated the first
  keyframe as the rest position, which cannot express "start displaced, end at
  rest" — a rise began at rest and ended 24px above where the layer was drawn.
  `playback.origin` now states which convention applies.

- **Background detection averaged the four corners**, so one dark corner — a
  vignette, or a mark clipping the edge — dragged the target colour off the
  actual backdrop and the fill matched nothing. Now a median over the border.

- **`animation(op:export)` reported success without producing a file.** It
  rendered HTML to a temp path, deleted it, and returned `okResult` with an
  `output_path` that was never written, alongside a hint naming
  `npx folio export-anim` — a command that does not exist (`package.json`
  `bin` has only `folio-mcp`). A model calling it received `ok` and a path, and
  told the user their GIF was ready. Seven tests asserted `success: true` for
  `gif`/`mp4`/`webm` on a host with neither Puppeteer nor ffmpeg and none
  checked that a file existed, which is why it survived. `gif`/`mp4`/`webm` now
  refuse with the reason and point at `svg`/`html`; the tests assert a real file
  on disk.

- **`document.dpi` ignored by the vector PDF exporter**, which hard-coded 96.
  A poster authored for print came out physically wrong: an A2 sheet drawn at
  2480×3508 (150 dpi) produced a 656×928 mm page instead of 420×594 — right
  proportions, 1.56× too big, and the print shop has to rescale it. Falls back
  to 96 when the field is absent, so screen designs export byte-identically.

- **`animation(op:export)` always rendered page 1** of a multi-page design.
  `page_id` now selects the page.

- **Animation export tests were not hermetic** — four asserted the no-ffmpeg
  fallback while simply trusting the host not to have ffmpeg, so they were
  green on a bare CI runner and failed the moment ffmpeg appeared on a dev box.
  Also fixes a real defect they were hiding: in `auto` mode a *failing* ffmpeg
  discarded the frames the caller had already paid to capture, rather than
  falling back to the manifest.

## [0.1.2] - 2026-07-11

Know your version, keep your canvas. A deployed Folio can now tell you when a new
release exists, and two finalize passes no longer damage a deliberately
hand-built poster.

### Added

- **Upstream release detection** (`src/mcp/update-check.ts`) — the engine polls
  the GitHub Releases API (daily, jittered, floored at 1h) and reports the result
  on a new unauthenticated `GET /version`, plus `update_available` on `/health`:

  ```json
  {"current":"0.1.2","latest":"0.1.3","update_available":true,
   "release_url":"https://github.com/azzindani/Folio/releases/tag/v0.1.3"}
  ```

  A monitor or a one-line cron can now alert on a stale deployment without
  holding an API token. Polling rather than a webhook, because a release webhook
  needs a public URL and a secret *per deployment* and most self-hosted installs
  sit behind NAT with no inbound port. No telemetry (an anonymous, unauthenticated
  GET — nothing about you is sent), fail-silent (offline or rate-limited keeps the
  last good answer and never affects serving), opt out with `FOLIO_UPDATE_CHECK=0`,
  point at a fork with `FOLIO_UPDATE_REPO`.
- **Opt-in auto-apply** — `docker compose --profile autoupdate up -d` adds a
  label-scoped Watchtower that can only ever touch the `folio` container. Kept
  separate from detection and OFF by default: a server that pulls and restarts
  *itself* can die mid-render, and it turns any registry compromise into code
  execution on every deployment. Requires a registry image
  (`FOLIO_IMAGE=ghcr.io/azzindani/folio:latest`). Posture table (manual / pinned /
  unattended) in `docs/DEPLOYMENT.md` §4.5.

### Fixed

- **A deliberate canvas is no longer resized by a rescue pass.**
  `trimTrailingDeadBand` honored a deliberate ratio only in *portrait*, so any
  **landscape** canvas was trimmable. Composing a 3840×2160 (16:9) conference
  poster over several `add_layers` calls looks top-anchored while the lower
  columns are still on the way — the pass rewrote `document.height` 2160 → 368
  (the height of the header band) and snapped the next column into the remnant.
  New `isDeliberateCanvasRatio` recognizes standard ratios in **either**
  orientation (16:9, 3:2, 4:3, ISO A, 16:10, 1:1, 4:5, 9:16 …) and gates the trim.
- **Seal-time de-dupe no longer deletes a legitimate layer.**
  `collapseDuplicateSections` keyed on text *characters* alone, at any depth and
  with no proximity check, so a poster printing its repo URL small+teal in the
  header and again big+white in the footer CTA had the CTA **silently deleted** —
  leaving an empty text husk that then failed export with `"Text layer requires
  content"`. The signature now carries each text's size/colour/weight (the same
  words in a different visual role are not a duplicate), and a duplicate must
  *overlap its twin horizontally* — thrash stacks down one column, while identical
  blocks side by side are a deliberate multi-column layout (that one was latent:
  identical cards in a grid would have been collapsed).
- **The server knows its own version.** `/health` and the MCP `serverInfo` reported
  a hardcoded `1.0.0` regardless of the package version; both now read
  `package.json`.

## [0.1.1] - 2026-07-11

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
