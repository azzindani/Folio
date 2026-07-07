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

## A. Assets + file system (expectation 03) — the new front

| P | Req | State |
|---|---|---|
| M | HTTP upload endpoint on :4173 (`POST /__project_files/<project>/assets/…`, auth-gated, size-capped, type-allowlisted) | ✗ |
| M | Editor drag-drop saves the dropped image to `<project>/assets/images/` + inserts layer referencing the saved path (no base64-in-YAML) | ✗ (drop inserts transient src today) |
| M | `manage_design {op:"asset_add"}` — data: URI in, file + manifest out, dims + dominant colors returned | ✗ |
| M | `manage_design {op:"asset_list"}` — manifest with dims/colors/luminance/alt (blind-model placeable) | ✗ |
| M | `src:"assets/…"` resolves identically: editor canvas (→ /__project_files) · resvg PNG (→ data-URI embed) · vector PDF · self-contained HTML | ✗ (export lookup exists; editor + PNG embed don't) |
| M | Missing-asset behavior: styled placeholder + note (never blank, never crash) | ✓ |
| M | Asset caps: per-file + per-project quota, env-tunable | ✗ |
| M | `diagnose_design` flags stretched/upscaled images + text-over-busy-photo without scrim | ✗ |
| N | `manage_design {op:"asset_delete"}` → .trash + ref flagging | ✗ |
| N | `extract_reference {store:true}` — analyzed reference saved as asset | ✗ |
| N | `get_engine_guide {section:"assets"}` | ✗ |
| N | Photo treatments: mask shapes, focal-point crop, auto-scrim; duotone verified on image layers | ◐ (effects pipeline exists; image-layer plumbing unverified) |
| N | Project font upload → editor FontFace + server export font set | ✗ |
| N | `_shared` cross-project asset library | ✗ |
| N | https-URL ingest (opt-in env, off for air-gapped) | ✗ |
| N | Editor asset panel (browse assets, drag onto canvas) | ✗ |
| N | `$project.assets.*` token resolution (currently spec-only in DESIGN.md) | ✗ |

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
| N | Locked-group children inspectable via edit_layer/inspect | ✗ (known gap) |

## D. Editor / studio (expectation 04)

| P | Req | State |
|---|---|---|
| M | MCP-design editability: deep selection, page ops, href field, save-to-library | ✓ |
| M | Live SSE refresh + library live catalog | ✓ |
| M | Desktop/tablet/phone widths all operable | ✓ |
| M | Common bbox + group transform for ad-hoc multi-select | ✗ |
| M | Alt-click click-through nested selection | ✗ |
| M | Boolean ops on shapes | ✗ |
| M | SVG import → layers | ✗ |
| M | Constraints/pinning; per-corner radius; resize-from-center | ✗ |
| M | Gradient editor handles; pattern/grain/blend panel controls | ✗ (engine renders; no UI) |
| M | First-load background flicker fix | ✗ |
| N | Asset panel (see A) · icon-nav right panel · history panel · isolation mode | ✗ |

## E. Outputs (expectation 05)

| P | Req | State |
|---|---|---|
| M | Server PNG (resvg + bundled TTFs), chart native-draw fallbacks | ✓ |
| M | Vector PDF: selectable text + clickable links + per-page carousels | ✓ |
| M | Self-contained HTML / report / presenter exports | ✓ |
| M | renderEntry() single render path | ✓ |
| M | Assets embedded at export (once A ships) | ✗ (blocked on A) |
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
| M | Asset quota enforcement (once A ships) | ✗ |
| N | Backup/restore one-liner doc (rsync recipe) | ✓ (documented) |
| N | Graceful optional-dep absence messages audit | ◐ |

## G. Testing (expectation 07)

| P | Req | State |
|---|---|---|
| M | Hand-written 100-case suite + diversity eval | ✓ |
| M | Vision-critic loop rig (render harness + review protocol) | ✓ (rig exists) |
| M | Gemma 3n E4B floor run + fix cycle | ✗ (planned — claude.lab harness) |
| M | Asset-system test coverage (upload → place → export round-trip) | ✗ (with A) |
| M | Infra-vs-engine triage discipline in every harness report | ✓ |
| N | Scheduled regression replay of past FAIL clusters | ◐ (manual today) |
