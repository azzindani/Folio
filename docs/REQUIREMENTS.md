# REQUIREMENTS.md — Must-Have / Nice-to-Have
# Derived from EXPECTATIONS.md · 2026-07-07

> **M** = must-have for the "complete studio" bar · **N** = nice-to-have.
> `[✓]` shipped · `[◐]` partial · `[✗]` missing — details in
> [GAP-ANALYSIS.md](GAP-ANALYSIS.md), execution in [ROADMAP.md](ROADMAP.md).
>
> **Standing constraint: the MCP surface stays at exactly 21 tools.**
> New capability lands as a new `op` on an existing multiplexed tool
> (`manage_design` / `themes` / `tasks` / `edit_layer` / `templates` /
> `report` / `presentation` / `animation`), a new field on a 1:1 tool, or a
> new `get_engine_guide` section. Update `tool-remap.ts` + no-field-collision
> invariant when touching ops.

---

## A. Assets + file system (expectation 03) — **musts SHIPPED 2026-07-07**
(commits 7376445 · 1ff5e7e · 43907f3 — live-verified on the deployed container)

| P | Req | State |
|---|---|---|
| M | HTTP upload endpoint on :4173 (`POST /__project_files/<project>/assets/…`, auth-gated, size-capped, type-allowlisted) | ✓ (verified 200/413/415/401) |
| M | Editor drag-drop saves the dropped image to `<project>/assets/images/` + inserts layer referencing the saved path (no base64-in-YAML) | ✓ (local-file designs keep the inline fallback) |
| M | `manage_design {op:"asset_add"}` — data: URI in, file + manifest out, dims + dominant colors returned | ✓ (+ alt field, ready-to-place layer_stub baton) |
| M | `manage_design {op:"asset_list"}` — manifest with dims/colors/luminance/alt (blind-model placeable) | ✓ (merges on-disk orphans) |
| M | `src:"assets/…"` resolves identically: editor canvas (→ /__project_files) · render_preview · resvg PNG (→ data-URI embed) · vector PDF · self-contained HTML | ✓ (ONE resolver, byte-sniffed mime; fixture verified in all surfaces) |
| M | **No silent blanks**: unresolvable src → placeholder + note in editor, preview, export AND diagnose (all four) | ✓ (missing file / https / bad data: URI) |
| M | Preview == export image parity (one resolver, three consumers) | ✓ (documented exception: editor CAN display https; exports placeholder + note) |
| M | Engine guidance never recommends a src type exports can't render | ✓ (add_layers note → asset_add/asset_list) |
| M | Asset caps: per-file + per-project quota, env-tunable | ✓ (FOLIO_MAX_ASSET_BYTES 8MiB · FOLIO_MAX_ASSETS_TOTAL 256MiB) |
| M | `diagnose_design` flags unresolvable + stretched (>5%) + upscaled (>2×) images | ✓ (text-over-busy scrim check pending; luminance class ships in asset_list) |
| N | Image FILLS (`fill:{type:"image"}`, incl. multi-fill) resolve by the same asset rules | ✓ |
| N | `manage_design {op:"asset_delete"}` → .trash + ref note | ✓ |
| N | `get_engine_guide {section:"assets"}` | ✓ |
| N | svg script-stripping at ingest (editor executes svg) | ✓ |
| N | Photo-first archetypes: hero-image poster, photo split, photo card grid (expectation 03 §8.5) | ✗ (now unblocked) |
| N | `extract_reference {store:true}` — analyzed reference saved as asset | ✗ |
| N | Photo treatments: mask shapes, focal-point crop, auto-scrim (WP-1.5) | ◐ (fit/fills/effects ship; masks/focal pending) |
| N | Project font upload → editor FontFace + server export font set (WP-1.6) | ✗ |
| N | `_shared` cross-project asset library | ✗ |
| N | https-URL ingest (opt-in env, off for air-gapped) | ✗ |
| N | Editor asset panel (browse assets, drag onto canvas) | ✗ |
| N | `$project.assets.*` token resolution (spec-only in DESIGN.md) | ✗ |

## B. Design quality (expectation 01)

| P | Req | State |
|---|---|---|
| M | examples/-level output on real model runs (101–116 program) | ✓ |
| M | Zero AI tells in sealed output (ai-slop lint enforced in diagnose/add_layers) | ✓ |
| M | Full archetype set incl. pricing/versus/timeline/mindmap/newsletter/cards | ✓ |
| M | Spatial rescue passes (geom/text/legibility/autoplace/pages/charts) + `locked` exemption + unified containment | ✓ |
| M | Diversity: no preset monocultures; procedural bg + mood lanes + title treatments | ✓ (keep measuring per release) |
| M | Default to ONE design; options only when asked | ✓ |
| N | Design-power WS2–6 (richness workstreams beyond WS1 patterns/duotone) | ✗ |
| N | Spot illustrations vocabulary | ✗ (deferred) |
| N | Theme-aware mood seeding (light-clean respected by content seeding) | ✗ (deferred — regression-risky) |

## C. Model support (expectation 02)

| P | Req | State |
|---|---|---|
| M | next_action baton completes poster + carousel end-to-end, blind | ✓ |
| M | Tiered stdio (6/7/8) + full-21 HTTP; sizing table published + true | ✓ |
| M | Payload recovery (aliases, JSON-in-text, style.* lift, null strip) | ✓ |
| M | `FOLIO_GUIDANCE=minimal` + `locked` escape hatch for frontier | ✓ |
| M | Context recovery (tasks/design resume) | ✓ |
| M | Gemma 3n E4B floor validated by a real harness run | ◐ (30B-class validated; E4B run not yet done) |
| N | Per-model-class OUTPUT_BUDGET presets documented in INTEGRATIONS.md | ◐ |
| N | Locked-group children inspectable via edit_layer/inspect | ✓ (shipped 2026-07-07: inspect recurses w/ parent+locked; update returns unlock recipe) |

## D. Editor / studio (expectation 04)

| P | Req | State |
|---|---|---|
| M | MCP-design editability: deep selection, page ops, href field, save-to-library | ✓ |
| M | Live SSE refresh + library live catalog | ✓ |
| M | Desktop/phone widths operable | ✓ (phone toolbar wraps, panels = sheets; live-swept 2026-07-10) |
| M | TABLET 768–1023px operable | ✗ (live 2026-07-10: left overlay open on load hides canvas + 276px page hScroll + view not fit — B8) |
| M | Common bbox + TRUE group transform for ad-hoc multi-select | ✓ (RE-VERIFIED at model level 2026-07-10: proportional scale of all selected layers + single undo; 07-07 "one layer" claim was a minimap measurement artifact) |
| M | Right-click context menu on canvas | ✗ (right-click selects, no menu — B10) |
| M | Floating align toolbar fully visible | ✗ (clipped under formula bar on every selection — B9) |
| M | Multi-select panel: Group/Ungroup + align + bbox X/Y/W/H | ✗ (only BOOLEAN/MASK shown) |
| M | Touch tap targets ≥40px | ✗ (9 toolbar buttons <32px — B11) |
| M | Alt-click click-through nested selection | ✓ (click reaches nested/locked children; Alt+click cycles stacks) |
| M | Boolean ops on shapes | ◐ (Clip Mask/Release Mask panel shipped; union/subtract unverified) |
| M | SVG import → layers | ✗ |
| M | Constraints/pinning | ✗ (but per-corner radius ✓ panel toggle · resize-from-center ✓ Alt-drag, center-preservation verified) |
| M | Gradient editor handles; pattern/grain/blend panel controls | ◐ (blend dropdown ✓; Solid/Linear/Radial/None fill UI ✓; NO image/pattern fill UI) |
| M | First-load background flicker fix | ✓ (not reproducible live 2026-07-10 — first paint at DCL+200ms already complete) |
| N | Asset panel (see A) · icon-nav right panel · history panel · isolation mode | ✗ |

## E. Outputs (expectation 05)

| P | Req | State |
|---|---|---|
| M | Server PNG (resvg + bundled TTFs), chart native-draw fallbacks | ✓ |
| M | Vector PDF: selectable text + clickable links + per-page carousels | ✓ |
| M | Self-contained HTML / report / presenter exports | ✓ |
| M | renderEntry() single render path | ✓ |
| M | Assets embedded at export | ✓ (shipped with A — data-URI embed, byte-sniffed) |
| N | PPTX editable text (raster today) | ✗ |
| N | Editor-button vector PDF (browser TTF gap) | ✗ |
| N | Lottie/GIF/MP4 kept green with optional deps absent | ✓ |

## F. Platform + ops (expectation 06)

| P | Req | State |
|---|---|---|
| M | Two-lifetime auth model (30d session / 30m output links) | ✓ |
| M | Editor front-door: token/cookie sole gate + opt-in IP/rate/heavy guards | ✓ |
| M | 4g mem envelope survives harness + editor concurrently | ✓ |
| M | Snapshots + .trash soft deletes | ✓ |
| M | Asset quota enforcement | ✓ (shipped with A) |
| N | Backup/restore one-liner doc (rsync recipe) | ✓ (documented) |
| N | Graceful optional-dep absence messages audit | ◐ |

## G. Testing (expectation 07)

| P | Req | State |
|---|---|---|
| M | Hand-written 100-case suite + diversity eval | ✓ |
| M | Vision-critic loop rig (render harness + review protocol) | ✓ (rig exists) |
| M | Gemma 3n E4B floor run + fix cycle | ✗ (planned — claude.lab harness) |
| M | Asset-system test coverage (upload → place → export round-trip) | ✓ (28 unit+integration tests; CI wiring = WP-6.1) |
| M | Infra-vs-engine triage discipline in every harness report | ✓ |
| N | Scheduled regression replay of past FAIL clusters | ◐ (manual today) |
