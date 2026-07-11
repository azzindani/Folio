# ROADMAP.md — Folio v0.1.0 → v0.2.0
# Self-contained work packages — executable by any capable agent (written for
# hand-off; assumes NO prior session context) · 2026-07-07

> Chain: [EXPECTATIONS.md](EXPECTATIONS.md) → [REQUIREMENTS.md](REQUIREMENTS.md)
> → [GAP-ANALYSIS.md](GAP-ANALYSIS.md) → **this plan**.

## Ground rules (bind every package)

```
1. MCP tools stay EXACTLY 21. New capability = new `op` on an existing
   multiplexed tool (manage_design/themes/tasks/edit_layer/templates/report/
   presentation/animation), a new field on a 1:1 tool, or a new
   get_engine_guide section. When adding/renaming ops: update dispatch.ts,
   the tier registry schema, tool-remap.ts REMAP if hints change, and keep
   the no-field-collision invariant (shared arg names must mean the same
   thing across ops of one tool).
2. Model designs, engine assists (CLAUDE.md §0.4). No canned layouts. If a
   change makes outputs more uniform, it is wrong.
3. Every src file ≤700 lines (eslint max-lines). Facades re-export siblings —
   edit the sibling, split before you hit the cap.
4. Work on main, no branches. Commit + push directly (retry push 4×:
   2s/4s/8s/16s). TS strict, no console.log (src/utils/debug.ts), no TODOs,
   tests alongside code.
5. Deploy: MCP/server-side = `docker cp src/. folio:/app/src && docker
   restart folio` then `curl -fsS localhost:3333/health`. Editor client
   changes need a dist rebuild — do it in CI/runner, NEVER on the host
   (vite build OOMs; exit 144 = OOM-killed).
6. Verify like the harness: after engine changes, run one end-to-end design
   on the live MCP (create_project → create_design → add_layers →
   render_preview → seal → export) and LOOK at the render.
7. Never put the production URL (folio.casava.space) inside generated design
   CONTENT; repo URL is fine.
```

## Phase map

```
P1  Asset System                 🔴 structural gap — do first        (WP-1.1 … 1.6)
P2  Design-power resumption      🟡 quality compounding              (WP-2.1 … 2.3)
P3  Local-model floor + gotchas  🟠 proves the local claim           (WP-3.1 … 3.4)
P4  Editor tier-1 UX batch       🟠 human-side friction              (WP-4.1 … 4.6)
P5  Export polish                🟡                                   (WP-5.1 … 5.2)
P6  Test/infra hardening + v0.2.0 release                            (WP-6.1 … 6.3)
```

Dependencies: P1 before P5 asset items; WP-1.2 before WP-1.4/1.5; P3.1 anytime
after P1 stabilizes; P4 independent (but needs CI dist rebuild); P6 last.

---

# P1 — ASSET SYSTEM (must-have cluster)

Goal: operator uploads photos/logos/fonts; model lists + places them; every
surface renders them. Storage contract: files under `<project>/assets/
{images,icons,fonts}/`, manifest in `project.yaml` `assets:` (regenerable by
dir rescan — files are truth). No base64 in `.design.yaml`.

### WP-1.1 · HTTP ingest + editor drag-drop rerouting
- **Files**: `src/editor/static-server.ts` (routes; note: server file, no dist
  rebuild), `src/editor/image-import-handler.ts` + `src/editor/auto-save.ts`
  (client → dist rebuild), new `src/mcp/engine/assets.ts` (shared fs helpers:
  sanitize filename, type allowlist png/jpg/webp/svg/avif/ttf/otf/woff2,
  caps, manifest read/write).
- **Do**: `POST /__project_files/<project>/assets/<kind>/<name>` — raw-bytes
  body, same auth gate as PUT design, per-file cap `FOLIO_MAX_ASSET_BYTES`
  (default 8 MiB) + per-project quota `FOLIO_MAX_ASSETS_TOTAL` (default
  256 MiB), returns `{path, width, height, bytes}` (dims via the existing
  `decodeImage` in `src/mcp/engine/reference.ts` — reuse, don't duplicate).
  Rewire editor drop: upload first, then insert layer with
  `src:"assets/images/<name>"`; keep pure-local fallback (File System Access
  mode) unchanged.
- **Accept**: curl-upload lands file + manifest entry; oversize → 413;
  bad type → 415; traversal (`../`) → 400; dropped image in a server-backed
  design produces a YAML with a relative src and NO base64.
- **Test**: unit for assets.ts; integration route tests next to
  static-server tests; Playwright drop test at desktop width.

### WP-1.2 · MCP asset ops (manage_design) + metadata
- **Files**: `src/mcp/dispatch.ts` (`dispatchManageDesign`),
  `src/mcp/tier1/registry.ts` (manage_design schema: add ops
  `asset_add|asset_list|asset_delete`), `src/mcp/engine/assets.ts`,
  `src/mcp/handlers.ts` untouched (dispatch covers it).
- **Do**: `asset_add {project_path, name, data|source_path, kind?, alt?}` —
  data: URI (cap as WP-1.1) or in-sandbox path; compute + store manifest
  metadata `{id, path, kind, width, height, bytes, dominant_colors[≤4],
  luminance: dark|light|busy, alt}` (dominant colors: reuse the palette
  classifier in `engine/reference.ts`). `asset_list {project_path}` → rows
  (respect FOLIO_OUTPUT_BUDGET: cap rows, `search` filter). `asset_delete`
  → move to project `.trash/`. `next_action` after asset_add = add_layers
  stub with the path + native dims prefilled.
- **Accept**: blind round-trip works over live MCP: asset_add(data:) →
  asset_list shows dims+colors → add_layers places `src:"assets/…"` → seal.
- **Test**: co-located `assets.test.ts` incl. dispatch op routing + budget
  trimming; reconnect caveat: clients cache tools/list — reconnect to see
  schema changes.

### WP-1.3 · Uniform src resolution (editor + resvg + PDF + HTML)
- **Files**: `src/renderer/render-entry.ts` or a new
  `src/renderer/asset-resolver.ts` (ONE resolver, injected context),
  `src/editor/canvas.ts` (base URL context), `src/mcp/engine/svg-export.ts` +
  `src/mcp/engine-export-tools.ts` (embed), `src/export/html-assembler.ts`.
- **Do**: resolver contract — input `src`, design path, project path; output
  per-surface: editor → `/__project_files/<project>/assets/…` URL (cookie
  auth rides); server export → read file, embed `data:` URI into the SVG
  BEFORE resvg/jsPDF/PPTX/HTML assembly; keep `flagMissingImages()` search
  order (design dir → parent → project → project/assets) as THE contract for
  both. SVG export: inline by default.
- **Do (additions from the 2026-07-07 live audit)**: `render_preview` MUST run
  the same resolver as export (today it skips even the missing-asset pass);
  enforce the **no-silent-blanks invariant** — any unresolvable src (missing
  file, unfetchable https, undecodable data: URI) yields the placeholder
  frame + note in preview AND export (today a file that EXISTS exports a
  silent blank because only existence is checked, nothing embeds); reword the
  `add_layers` note that recommends `https://` srcs (exports can't fetch
  them); extend the resolver to image FILLS (`fill:{type:"image"}`,
  `renderImageFill`) with the same rules.
- **Accept**: the live fixture `gap-audit/designs/image-src-matrix.design.yaml`
  (KEEP it — it is the acceptance repro; place any test file at
  `gap-audit/assets/images/team.jpg`) renders panel A (assets/ path), panel B
  (data: URI) and panel C (https, once ingest-fetch or an explicit
  cannot-export note exists) correctly and identically in (a) editor canvas,
  (b) render_preview, (c) export_design png/pdf/html — and every
  unresolvable variant shows placeholder + note in all three. resvg 2.6.2
  data-URI rendering is verified working (href AND xlink:href), so failures
  are resolver bugs, not resvg.
- **Test**: renderer unit w/ mock fs; export integration writing a real
  png fixture; visual snapshot; the 10-cell src matrix as a table test.

### WP-1.4 · Model-facing intelligence — **SHIPPED 2026-07-11**
Distortion >5% + upscale >2× flags and the `assets` guide section shipped
with the asset system; this WP added the third diagnose flag — `text_on_busy_
image` (text ≥60% on a manifest-classified busy photo with no painted scrim
between them in z, suggestion tier) — and `enrich_brief {project_path}`: when
the project holds assets the plan says so up front (`project_assets` counts +
an asset_list/place clause, alt-text named). Live-verified. Original spec:
- **Files**: `src/mcp/engine/guide.ts` (+`assets` section ≤200 tokens),
  `src/mcp/engine/enrich.ts` (mention available assets when project has
  any), `src/mcp/engine-export-tools.ts`/`diagnose` path (new checks).
- **Do**: diagnose flags — aspect distortion >5% (layer w/h vs native),
  upscale >2× native, text overlapping an image whose luminance=busy without
  a scrim layer between (reuse local-backdrop logic from
  `engine-finalize-legibility.ts`).
- **Accept**: seeded broken design triggers all three notes; guide section
  returns; enrich_brief on an asset-bearing project mentions them.

### WP-1.5 · Photo treatments — **SHIPPED 2026-07-11**
`mask:"circle|blob|arch|rounded|hex"` (clipPath, implies cover) ·
`focal:[fx,fy]` (0–1 → preserveAspectRatio thirds) · `overlay:{fill,opacity,
blend}` scrim inside the mask · `frame:{stroke,width,offset}` outline
following the mask shape. Blob is layer-id-seeded (deterministic). All
verified in a live resvg render (5-cell proof sheet). Also fixed: image
shorthand silently DROPPED `fit` (asset stubs recommend fit:"cover"!) —
fit/alt/role/crop now pass through. Guide assets section documents the
treatments. Original spec:
- **Files**: `src/mcp/shorthand-expand.ts` + `shorthand-helpers.ts` (image
  shorthand fields), `src/renderer/layer-renderers-shapes.ts` (renderImage:
  clip-path masks, focal crop via preserveAspectRatio+viewBox math),
  `src/renderer/effects-renderer.ts` (verify duotone/grayscale/blur apply to
  image layers under resvg).
- **Do**: `mask: circle|blob|arch|rounded|hex`, `focal:[x,y]` crop,
  `overlay:{fill,opacity,blend}` auto-scrim child, `frame:{stroke,offset}`.
  Every treatment must rasterize in resvg (no foreignObject).
- **Accept**: treatment matrix design (one image per treatment) exports PNG
  with all treatments visible; editor renders identically.

### WP-1.6 · Project fonts — SHIPPED
- **Files**: `src/utils/font-name.ts` (NEW — pure filename→family/weight, shared
  client+server), `src/mcp/engine/fonts.ts` + `pdf-fonts.ts` (lookup extended to
  `<project>/assets/fonts`: `resvgFontOption`/`unbundledFonts`/`pickFont` take an
  optional `projectDir`), `src/mcp/engine-export-tools.ts` + `engine/pdf-build.ts`
  (thread project dir through render_preview/export/vector-PDF), `src/styles/
  font-loader.ts` (`loadProjectFonts` — FontFace from `/__project_files` mount),
  `src/editor/app.ts` (`loadProjectFonts` on project open, off the `__assets` list).
- **Accept**: uploaded TTF renders in editor + PNG + selectable in vector PDF.
  Live-verified on a `wp16-fonttest` project (non-bundled family `Zephyr Signal`):
  family discovered from filename, resvg pointed at the project dir, unbundled
  warning suppressed with projDir / raised without, vector-PDF resolves the
  project TTF, real resvg PNG renders the glyphs (2489 vs 490 blank-control bytes).

---

# P2 — DESIGN-POWER RESUMPTION

Context: a 6-workstream program for richer, less-AI output; WS1 (pattern +
texture fills, duotone) shipped. Litmus for every item: MORE variance, never
less (ground rule 2).

### WP-2.1 · WS2–6 workstreams — WS4 SHIPPED (concrete subset)
- **WS4 texture/print finishes — DONE**: four new print-finish patterns —
  `newsprint` (fine dot screen), `riso` (coarse spot-print dots), `engraving`
  (etched hairlines), `mezzotint` (aquatint stipple). All deterministic +
  seamless-tileable + resvg-safe. Files: `src/schema/types/primitives.ts`
  (PatternName), `src/renderer/pattern-renderer.ts` (BASE_TILE + builders),
  `src/mcp/shorthand-helpers.ts` (PATTERN_NAMES), `shorthand-background.ts`
  (liney contrast for engraving), `engine/guide.ts` (model vocabulary).
  Rendered + vision-reviewed via a 4-cell resvg proof sheet (all read distinct);
  full renderer + bg-texture suites green.
- **Remaining (deferred)**: WS2 spot-illustration/doodle vocabulary beyond the
  shipped scatter (`shorthand-doodles.ts`), WS3 editorial grid systems
  (baseline/column snap hints in guide + diagnose), WS5 type craft (optical
  sizing, tighter ladder via themes type_ladder), WS6 layout motifs (bleeds,
  overlaps, rotated blocks — verify finalize passes don't fight them).
- **Accept per WS**: 3+ example-level cases rendered + vision-reviewed; suite
  green; diversity eval does not regress.

### WP-2.2 · Catalog packs over MCP — SHIPPED
- Read-only `themes {op:"packs"}` (new op on the frozen `themes` tool — no new
  tool): omit `kind` → the three kinds + counts; `kind:"palette|type|effects"`
  (+ optional `search`) → filtered listing with values inline; `+id` → one
  pack's full usable values. Reads the compact `src/styles/{palette,type-pack,
  effects-pack}-index.json` the editor lazy-loads (swatches / families /
  effectKeys). Files: `src/mcp/engine/packs.ts` (NEW), `dispatch.ts`,
  `tier1/registry.ts` (op enum + args; `project_path` no longer required so
  packs needs no project).
- **Accept**: met live — `id:"80s-pop"` returns 5 hexes in 98 tokens; a named
  type pack returns heading/body/mono; `search` filters by tag/name. All ≤300.

### WP-2.3 · Theme-honoring mood seeding (deferred as regression-risky — care)
- `src/mcp/engine/enrich.ts` + mood-bank: when the project theme is
  explicitly light (e.g. light-clean), content-seeded mood must not force a
  dark lane. Guard with regression tests over the 101–116 case set BEFORE
  changing defaults.

---

# P3 — LOCAL-MODEL FLOOR + MCP GOTCHAS

### WP-3.1 · Gemma 3n E4B floor validation ★ operator-assisted
- **Rig**: harness lab at `/root/Harnesses` (harness-claude registers the
  deployed Folio HTTP MCP; `tools/harness-suite/run_live.py` drives live
  sessions; the claude.lab.casava.space harness runs mid-size models).
  Config: tier 1 only, `FOLIO_OUTPUT_BUDGET=600`, `MCP_CONSTRAINED_MODE=true`,
  20 hand-written cases from the 100-suite (never templated).
- **Loop**: run → render every design (`tools/audit/render-harness.mjs`) →
  vision-review renders → classify infra vs model vs engine (infra: OOM /
  OpenRouter :free 429 resets 00:00 UTC / plan-mode slip) → engine fixes
  land with failing-case tests → re-run cluster. Wipe `suite-*` dirs before
  a clean from-1 run. Only SEALED designs count as done.
- **Accept**: ≥90% sealed, ≥18/20 strong, 0 blank posters, published sizing
  row for E4B verified in MCP.md §3.

### WP-3.2 · Locked-group children inspectable
- `manage_design {op:"inspect"}` + `edit_layer {op:"update"}`: recurse into
  `locked` groups read-only (inspect shows children + lock flag); update on a
  locked child fails with a hint naming the unlock path (patch_design on the
  group's locked field) instead of silently no-oping.
- **Files**: `src/mcp/engine-project-tools.ts` (inspectDesign),
  `src/mcp/engine-edit-tools.ts`. **Accept**: live-verified failure case
  passes — `manage_design {op:inspect}` on `gap-audit/image-src-matrix`
  lists the `locked_panel` children (with a lock flag), and
  `edit_layer {op:update, layer_id:"lp_accent"}` either applies or fails
  with a hint naming the actual unlock path. No rescue-pass behavior change
  (`isLocked` untouched).
- **Also**: sweep engine hint/error STRINGS for pre-consolidation tool names
  (live-caught: "Use inspect_design to find layer IDs") — `tool-remap.ts`
  rewrites structured fields only, so prose must name consolidated tools
  (`manage_design {op:inspect}`); grep engine-*.ts for the 34 old names in
  the REMAP table.

### WP-3.3 · append_page in-place replace — **SHIPPED 2026-07-11**
`replace:true` + existing `page_id` overwrites that page IN PLACE (order +
other pages byte-identical — unit-asserted); label kept when not passed;
editor link focuses the replaced slot. Without `replace` the rename survives
and the hint names the flag. Live-verified both paths on a 4-page deck.

### WP-3.4 · Per-client budget presets (docs only)
- INTEGRATIONS.md: add the model-class table (E4B/9B/30B/frontier → tier,
  OUTPUT_BUDGET, CONSTRAINED_MODE) per client section. Keep MCP.md §3 the
  source; link, don't duplicate numbers.

### WP-3.5 · Seal-time duplicate-section collapse — **SHIPPED 2026-07-10**
`src/mcp/engine-finalize-dedupe.ts` in the seal sweep (before decollide):
identical ≥24-char text signatures at any depth + stacked ≥12-char echoes +
(thrash-gated) repeated identical images → keep first-in-flow; then compact
>160px gaps between surviving top-level content. Live repro: 20 blocks
collapsed, idempotent re-seal. 7 unit tests.

### WP-3.6 · Requested-ratio hardening — **SHIPPED 2026-07-10 (warn tier)**
Dead-band trim now runs at SEAL (posters); after rescue, ratio >2:1 with
meta.type=poster → loud `pWarn` + carousel hint in seal progress (engine
guides, never overrides model composition — §0.4). Full auto-reflow to the
exact requested ratio stays future work if the warning proves insufficient.

---

# P4 — EDITOR TIER-1 UX BATCH

⚠ All client-side → dist rebuild in CI/runner + `docker cp` of dist; verify
against the LIVE container (server-injected UI like the Library button is
absent in vite preview). Playwright at desktop/tablet/mobile widths per item.
Keep editor chrome flat (no drop-shadows).

Deep live audit 2026-07-10 (5 viewports, MODEL-level geometry) re-scoped this
package: ~~4.1 group transform~~ VERIFIED WORKING (proportional scale around
group origin + single undo — the 07-07 "one layer" claim measured minimap
clones). Also already shipped: Alt=center resize, per-corner radius toggle,
first-load flicker gone. New verified breakage promoted to the top.

| WP | Item | Key files | Accept |
|---|---|---|---|
| ~~4.1~~ | **SHIPPED 2026-07-10** — tablet rescue: default-collapse ≤1023px + `overflow: clip; position: relative` on `#app` (BOTH axes — x-only makes #app a scroll container) + later `left: 0` on the overlay (abspos grid items anchor to their GRID AREA, so `left: var(--activity-bar-width)` double-counted → 36px toolbox sliver over the canvas) | `app-base.ts`, `main.css` | ✓ live 820×1180: no hScroll, no sliver, canvas full width |
| ~~4.2~~ | **SHIPPED 2026-07-10** — right-click context menu; actions extracted to shared `layer-actions.ts` so keyboard + menu + panels drive ONE implementation | `context-menu.ts`, `layer-actions.ts` | ✓ live |
| ~~4.3~~ | **SHIPPED 2026-07-10** — align toolbar `top: calc(ruler + 8px)` | `main.css` | ✓ live |
| ~~4.4~~ | **SHIPPED 2026-07-10** — multi-select panel: bounds + Group/Ungroup + align/distribute grid | `properties-panel.ts` | ✓ live |
| 4.5 | ~~Touch tap targets ≥40px (B11)~~ **SHIPPED 2026-07-10** · REMAINING: Font Family shows resolved token font (B12) | `properties-panel-base.ts` | $heading shows its resolved family |
| ~~4.6~~ | **SHIPPED 2026-07-10** — Assets panel (left rail): GET `/__project_files/<project>/__assets` (shares `collectAssets` with MCP asset_list), thumbnails, click-inserts at native aspect | `asset-panel.ts`, `static-server.ts` | ✓ live + 120B blind E2E |
| ~~4.7~~ | **SHIPPED 2026-07-11** — `editor/boolean-ops.ts`: flatten each shape to polygon rings (rect/ellipse/polygon pure; `path` via off-DOM sampling) → union/subtract/intersect/exclude via bundled `polygon-clipping` (lazy chunk, NO runtime CDN) → one new `path` layer inheriting the bottom fill. Union/Subtract/Intersect/Exclude buttons in the boolean panel (2-layer select). | `boolean-ops.ts`, `properties-panel{,-base}.ts` | ✓ unit + resvg render (union of two rects → L-shape `M20 20L140 20…Z`) + live E2E (Union → one path, sources gone) |
| ~~4.8~~ | **SHIPPED 2026-07-11** — `editor/svg-import.ts` walks renderable leaves (rect/circle/ellipse/line/polygon/path/text), bakes each element's CTM into ABSOLUTE coords (`svg-path-transform.ts` applies the affine to path `d`; shapes decompose translate/scale/rotation, rotated rects → path) → native editable layers. "Import SVG as Layers…" command (file picker, lazy chunk). Skips defs/clip/mask. | `svg-import.ts`, `svg-path-transform.ts`, `command-palette.ts` | ✓ unit + live E2E: group `translate(50,30)` baked onto a rect (x50/y30), element `translate(100,100)` baked into path `d` |
| ~~4.9~~ | **SHIPPED 2026-07-11** — on-canvas gradient handles (pure `gradient-handles.ts`: linear two-endpoint axis → angle, radial center + radius; drawn in `canvas.ts` selection overlay, dragged via `canvas-interactions.ts`) + Pattern & Image fill tabs in the panel (writes the SAME spec MCP emits: `{type:pattern,pattern,fg,bg,scale,opacity}` / `{type:image,src,mode,tile_size,opacity}`) | `gradient-handles.ts`, `canvas{,-interactions}.ts`, `properties-panel{,-base}.ts` | ✓ unit + live E2E: linear fill shows 2 axis handles; Pattern/Image tabs write MCP-shaped fills |
| ~~4.10~~ | **SHIPPED 2026-07-11** — hover highlight was already wired (`canvas.ts` onCanvasHover → `.canvas-hover-box`); NEW pin constraints: pure `editor/pin-constraints.ts` (edge-offset hold + both-edges stretch + proportional float for unpinned axes, recurses groups against the doc) applied in `openResizeDialog`; L/T/R/B pin toggles in the properties panel (`properties-panel-base.ts` + `bindPinControl`) | `pin-constraints.ts`, `app-base.ts`, `properties-panel{,-base}.ts` | ✓ unit + live E2E: right-pinned box holds its 100px gap on 1000→1400 resize (x→1200) |

---

# P5 — EXPORT POLISH (nice-to-have)

### WP-5.1 · PPTX editable text — SHIPPED 2026-07-11
- Slides = pixel-faithful background image + NATIVE `<p:sp>` text boxes
  (editable + selectable in PowerPoint/Impress). `pptx-text-extract.ts` walks
  the layer tree (recurses groups) and promotes text whose appearance is
  reproducible (solid-hex colour, no rotation/effect/curve, no transformed
  ancestor); promoted layers are hidden in the raster so nothing draws twice —
  everything else stays baked in the image (the "keep raster fallback" rule),
  so the slide is always visually unchanged. Multi-paragraph, bold/italic,
  align/valign, font family, text-transform, and px→EMU/pt conversion handled.
- **Files**: `src/export/pptx-export.ts` (+ PptxText/txBox XML),
  `src/export/pptx-text-extract.ts` (NEW), `src/mcp/engine-export-tools.ts`.
- **Accept**: met — real export produces a valid PPTX (unzip -t clean) whose
  slide holds the background `<p:pic>` + a `<p:sp>` txBox with the design's
  text at the right EMU position/size/weight/colour; token-coloured text stays
  in the raster. (No LibreOffice in CI to auto-open; OOXML is standard txBox.)

### WP-5.2 · Editor-button vector PDF — SHIPPED 2026-07-11
- Chosen path: SERVE the fonts, don't bundle them (keeps the bundle budget).
  The build (`folioFontsPlugin.writeBundle`) copies `src/mcp/fonts/*.ttf` +
  `manifest.json` into `dist/fonts/`; the production static-server serves
  `dist/` so `/fonts/manifest.json` + `/fonts/<ttf>` resolve (verified live:
  both 200). The editor PDF export (`exporter.ts exportToPDF` → `pdf-vector-
  browser` + `pdf-fonts-browser.loadVectorFont`) fetches the TTF bytes and
  embeds them in jsPDF, preferring true vector for non-interactive designs and
  falling back to raster+invisible-text otherwise.
- **Accept**: met — live E2E exports a text poster from the editor; the PDF
  starts `%PDF` and contains `FontFile2` (an embedded TrueType program) →
  selectable vector text, not a flat raster. Production `/fonts/*` serve 200.

---

# P6 — TEST/INFRA HARDENING + RELEASE

### WP-6.1 · Asset round-trip suite
- Integration: upload (HTTP + MCP) → list → place → editor render (Playwright)
  → PNG/PDF export assert image bytes present → delete → placeholder+note.
  Add to CI integration job (runner has RAM for it).

### WP-6.2 · Scripted FAIL-cluster regression replay
- Script (tools/harness-suite): replay stored failing payloads from past
  clusters (blank-poster z-sort, carousel overprint, style-lift, multipage
  heal, sections-spatial) straight against handlers — no model needed —
  assert healed geometry. Nightly-able.

### WP-6.3 · Release v0.2.0
- Enrich `CHANGELOG.md` `[0.2.0]` section FIRST (release.yml builds the body
  from it via awk), bump package.json, tag `v0.2.0`, push tag; GHCR job needs
  `SKIP_TESTS=1` build-arg + Actions write perms. Verify: release page body,
  image pulls, `/health` on a fresh `docker compose up` from the tag.

---

## Suggested order (one line)

WP-1.1 → 1.2 → 1.3 (ship the 🔴 core) → 1.4/1.5 → 3.1 (E4B proof) →
3.2/3.3 → 4.1/4.2 (worst human friction) → 2.1–2.3 → 4.3–4.6 → 1.6 →
5.x → 6.1/6.2 → 6.3 release.

