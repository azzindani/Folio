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

### WP-1.4 · Model-facing intelligence
- **Files**: `src/mcp/engine/guide.ts` (+`assets` section ≤200 tokens),
  `src/mcp/engine/enrich.ts` (mention available assets when project has
  any), `src/mcp/engine-export-tools.ts`/`diagnose` path (new checks).
- **Do**: diagnose flags — aspect distortion >5% (layer w/h vs native),
  upscale >2× native, text overlapping an image whose luminance=busy without
  a scrim layer between (reuse local-backdrop logic from
  `engine-finalize-legibility.ts`).
- **Accept**: seeded broken design triggers all three notes; guide section
  returns; enrich_brief on an asset-bearing project mentions them.

### WP-1.5 · Photo treatments
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

### WP-1.6 · Project fonts (nice-to-have — do last in P1)
- **Files**: `src/mcp/engine/fonts.ts` + `pdf-fonts.ts` (extend lookup to
  `<project>/assets/fonts`), `src/editor/app-base.ts` (FontFace load from
  manifest).
- **Accept**: uploaded TTF renders in editor + PNG + selectable in vector PDF.

---

# P2 — DESIGN-POWER RESUMPTION

Context: a 6-workstream program for richer, less-AI output; WS1 (pattern +
texture fills, duotone) shipped. Litmus for every item: MORE variance, never
less (ground rule 2).

### WP-2.1 · WS2–6 workstreams
- Rough scope (re-derive detail from `docs/COMPARISON-OPEN-DESIGN.md` +
  `src/mcp/engine/craft.ts`): WS2 spot-illustration/doodle vocabulary beyond
  the shipped scatter (`shorthand-doodles.ts`), WS3 editorial grid systems
  (baseline/column snap hints in guide + diagnose), WS4 texture/print
  finishes (riso/halftone/paper — extend `shorthand-background.ts` grammar),
  WS5 type craft (optical sizing, tighter ladder enforcement via themes
  type_ladder), WS6 layout motifs (bleeds, overlaps, rotated blocks — verify
  finalize passes don't fight them; extend containment tests).
- **Accept per WS**: 3+ example-level cases rendered + vision-reviewed; suite
  green; diversity eval does not regress.

### WP-2.2 · Catalog packs over MCP (no new tools)
- Editor Catalog has palettes/type-pairing/effects packs with NO MCP surface.
  Expose read-only: `themes {op:"packs", kind:"palette|type|effects"}` OR
  guide sections (`get_engine_guide {section:"palettes"}`) — pick whichever
  keeps token cost lowest; registry schema + dispatch update accordingly.
- **Accept**: a model can name a pack and get usable values (hexes/pairings)
  in ≤300 tokens.

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

### WP-3.3 · append_page in-place replace
- Today `append_page` with an existing `page_id` RENAMES (dupes) — fixing one
  deck page means rebuilding the deck. Make same-`page_id` an explicit
  replace: require `replace:true` to overwrite (else keep today's rename +
  return a hint), preserve page order, snapshot first, re-run per-page
  finalize + cross-page decollide.
- **Files**: `src/mcp/engine-layer-tools.ts` (appendPage), tier2 registry
  schema, tests incl. resume/task interaction. **Accept**: replace a middle
  page of a 5-page carousel; order + other pages byte-identical.

### WP-3.4 · Per-client budget presets (docs only)
- INTEGRATIONS.md: add the model-class table (E4B/9B/30B/frontier → tier,
  OUTPUT_BUDGET, CONSTRAINED_MODE) per client section. Keep MCP.md §3 the
  source; link, don't duplicate numbers.

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
| 4.1 | TABLET 768–1023 rescue (🔴 B8): (a) default-collapse the left overlay on load ≤1023px, (b) kill 276px page hScroll — `overflow-x: clip` on `#app` in the tablet media block (parked `translateX(105%)` overlays count toward scrollWidth), (c) verify fit-on-load pans correctly | `src/editor/app-base.ts` (wireActivityBar init), `src/styles/main.css` @768–1023 block | load live at 820×1024 → canvas visible + fit, no hScroll, panel opens/closes via activity bar |
| 4.2 | Right-click context menu (B10): duplicate · delete · group/ungroup · lock/unlock · bring/send order · copy/paste — reuse existing keyboard actions | new `src/editor/context-menu.ts` + `canvas-interactions.ts` (contextmenu handler) | right-click a layer → menu; every item works; Esc/click-away closes |
| 4.3 | Floating align toolbar de-clip (B9): position below ruler, never overlapping formula bar | `canvas-draw.ts` / `src/ui/toolbar` float positioning | select any layer at 1600/1280 → toolbar fully visible |
| 4.4 | Multi-select properties: Group/Ungroup button + align/distribute row + combined bbox X/Y/W/H (14.7) | `src/ui/panels/properties-panel*.ts` | 2+ selection shows Group (⌘G) + align buttons; group works from panel |
| 4.5 | Touch tap targets ≥40px (B11) + Font Family shows resolved token font (B12) | `src/styles/main.css` @(pointer: coarse), `properties-panel-base.ts` | audit `tinyTapTargets` = 0 on touch; $heading shows its resolved family |
| 4.6 | Asset panel: browse `<project>/assets` w/ thumbnails, click/drag inserts image layer (pairs with shipped WP-1 asset ops) | new left-panel view + `static-server.ts` asset-list GET | uploaded asset appears in panel; click inserts layer with `assets/…` src that renders |
| 4.7 | Complete booleans: add union/subtract/exclude → path layer | new `src/editor/boolean-ops.ts` (vendored path lib — NO runtime CDN) | two overlapping rects → union path renders identically in resvg |
| 4.8 | SVG import → layers | new `src/editor/svg-import.ts` | a Figma-exported SVG lands editable; export round-trips |
| 4.9 | Gradient handles on canvas + pattern/image fill panel controls | `properties-panel-base.ts`, gradient overlay in `canvas-draw.ts` | drag stops on canvas; pattern/image picker writes the same fill spec MCP emits |
| 4.10 | Constraints/pinning + canvas hover highlight (1.10) | `interactions.ts`, `canvas-interactions.ts` | pinned layer keeps edge offset on doc resize; hovered layer outlines |

---

# P5 — EXPORT POLISH (nice-to-have)

### WP-5.1 · PPTX editable text
- Replace raster-only slides with raster background + native text boxes for
  top-level text layers (positions/fonts from the design). Keep raster
  fallback for effect-heavy layers. **Files**: `src/export/pptx-export.ts`,
  `src/mcp/engine-export-tools.ts`. **Accept**: text selectable in
  LibreOffice Impress; layout visually unchanged.

### WP-5.2 · Editor-button vector PDF
- Browser path lacks the bundled TTFs. Either fetch font subset from the
  server (`/__project_files`-style endpoint serving `src/mcp/fonts` subset)
  or accept documented raster. Decide by bundle-size budget (<500KB gz).

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

