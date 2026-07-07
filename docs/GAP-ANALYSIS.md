# GAP-ANALYSIS.md — Expectation vs Current Condition
# 2026-07-07 · v0.1.0 baseline · verified against src (not docs)

> Method: expectations ([EXPECTATIONS.md](EXPECTATIONS.md)) vs code audit of
> `src/mcp`, `src/renderer`, `src/export`, `src/editor`, `src/fs`, `src/themes`.
> Severity: 🔴 blocks the product bar · 🟠 hurts daily use · 🟡 polish.
> "Next" = the concrete first action; work packages in [ROADMAP.md](ROADMAP.md).

---

## 1. Assets + file system — THE structural gap 🔴

Asset handling is a first-class *concept* with **no ingest path and no model
surface**. Verified current state:

```
EXISTS   create_project scaffolds assets/{fonts,icons,images}; project.yaml
         seeds assets:{fonts:[],images:[]} — nothing ever writes to either
EXISTS   image layer (type:"image", src → raw SVG href); fit cover/contain;
         styled placeholder when src missing/unresolved
EXISTS   export-time lookup: flagMissingImages() searches design dir → parent
         → project → project/assets, blanks missing src + notes
EXISTS   extract_reference reads a data:/local image (≤4MiB), returns palette
         + dims + brief — read-only, stores nothing
EXISTS   editor: drag-drop inserts image; Shift+drop = reference underlay;
         PUT /__project_files writes YAML (base64 images ride INSIDE yaml,
         write-capped for exactly that reason)
EXISTS   src/fs/project-folder.ts — browser-local folder assets as blob URLs
         (client-only, invisible to MCP/server)
```

| Gap | Severity | Next |
|---|---|---|
| No upload endpoint (HTTP or MCP) — a photo cannot enter the server at all | 🔴 | `POST /__project_files/<project>/assets/…` on static-server + `manage_design {op:"asset_add"}` (ROADMAP WP-1.1/1.2) |
| No asset listing for models — a model can't know what assets exist | 🔴 | `manage_design {op:"asset_list"}` reading dir + manifest (WP-1.2) |
| `src:"assets/…"` doesn't render in the editor (no /__project_files rewrite) and isn't embedded in resvg PNG/PDF (jsdom href stays a relative path → blank or placeholder) | 🔴 | one resolver used by canvas + svg-export: rewrite (editor) / data-URI-embed (server) (WP-1.3) |
| Editor drop = transient/base64 src, bloats YAML, dies on export | 🟠 | reroute drop through the upload endpoint (WP-1.1) |
| `$project.assets.*` token documented in DESIGN.md but absent from token-resolver | 🟡 | marked SPEC-ONLY in DESIGN.md (done); implement or drop with WP-1 |
| No asset metadata for blind models (dims, dominant colors, luminance, alt) | 🟠 | compute at ingest (decodeImage exists in reference.ts — reuse) (WP-1.2) |
| No quotas beyond ref-image 4MiB cap | 🟠 | per-file/project caps in upload paths (WP-1.1) |
| No photo-treatment plumbing verified on image layers (duotone/mask/scrim) | 🟠 | treatment matrix test then close holes (WP-1.5) |
| No project-font pipeline (upload → FontFace + resvg/jsPDF set) | 🟡 | WP-1.6 |
| No editor asset panel | 🟡 | WP-4.x, after MCP surface |

## 2. Design quality 🟢 mostly at bar

| Gap | Severity | Next |
|---|---|---|
| Design-power WS2–6 unshipped (WS1 patterns/duotone done) | 🟡 | resume program post-assets (WP-2.1) |
| Spot illustrations + mood-default deferrals | 🟡 | fold into WP-2 |
| Palettes/type/effects packs (editor catalog axes) have no MCP surface | 🟡 | expose via `themes {op:...}` / guide sections — no new tools (WP-2.2) |
| Content mood-seeding ignores an explicitly-set light theme (light-clean case) | 🟡 | guarded fix + regression suite (WP-2.3) |

## 3. Model support 🟠 one unproven floor

| Gap | Severity | Next |
|---|---|---|
| Gemma 3n E4B floor NEVER validated (30B-class was; E4B is 8× smaller) | 🟠 | dedicated harness run at tier-1/budget-600; fix cycle (WP-3.1, uses claude.lab rig) |
| Locked-group children opaque to `edit_layer`/`inspect` (carousel gotcha) | 🟠 | recurse-with-lock-flag in inspect + targeted update (WP-3.2) |
| append_page renames on existing page_id — no in-place page replace; deck fixes = full rebuild | 🟠 | make same-page_id append an explicit replace (WP-3.3) |
| Model-class budget presets scattered (MCP.md table only) | 🟡 | INTEGRATIONS.md per-client presets (WP-3.4, docs) |

## 4. Editor / studio 🟠 tier-1 backlog open

Shipped this cycle (verified): deep selection, page ops, aspect presets,
server auto-save, live library, tablet/mobile fixes, href field, reference
underlay. Remaining (UX_ROADMAP tier-1, all ✗ in code):

| Gap | Severity |
|---|---|
| Ad-hoc multi-select: no common bbox, no group transform | 🟠 |
| No alt-click click-through into groups (MCP designs are ONE group — this hurts most) | 🟠 |
| Boolean ops, SVG-import-to-layers, constraints/pinning | 🟠 |
| Gradient editor handles; pattern/grain/blend have no panel UI (engine renders them) | 🟠 |
| Per-corner radius, resize-from-center, first-load flicker | 🟡 |

Next: WP-4 batch; note editor changes need a dist rebuild (CI/runner — host OOMs).

## 5. Outputs 🟢 near bar

| Gap | Severity | Next |
|---|---|---|
| Asset embedding at export blocked on §1 | 🔴 (with assets) | WP-1.3 |
| PPTX slides are rasters (no editable text) | 🟡 | WP-5.1 (nice-to-have) |
| Editor-button PDF still raster (browser TTF gap) | 🟡 | WP-5.2 |
| report data sources query/sql/duckdb fail-loud, no connector | 🟡 | document as unsupported OR ship duckdb-wasm later |

## 6. Platform + ops 🟢 at bar

No 🔴/🟠 gaps. Watch items: asset quotas arrive with WP-1; optional-dep error
messages audit (🟡); keep FOLIO_ALLOW_IPS off for /mcp when hosted models must
reach it.

## 7. Testing 🟠 two holes

| Gap | Severity | Next |
|---|---|---|
| No asset round-trip coverage (upload → list → place → PNG/PDF verify) | 🟠 (with WP-1) | tests land INSIDE each WP-1 package |
| E4B-floor harness run missing (see §3) | 🟠 | WP-3.1 via claude.lab.casava.space + vision review |
| FAIL-cluster regression replay is manual | 🟡 | scripted replay (WP-6.2) |

---

## What to do next — priority order

1. **WP-1 Asset System** (🔴 cluster) — the only structural gap; unlocks
   "combine assets with design via MCP". 21-tool constraint respected
   (`manage_design` ops + `extract_reference` field + guide section).
2. **WP-3.1 E4B floor run** — proves the local-model claim end-to-end; cheap
   once assets are stable (reuses harness rig).
3. **WP-4 editor tier-1 batch** — biggest human-side friction (multi-select +
   alt-click first: they hurt every MCP-design edit).
4. **WP-2 design-power resumption** — quality compounding, not blocking.
5. **WP-5/6 polish** — PPTX text, browser PDF, scripted regression replay.

Full work packages with acceptance criteria: [ROADMAP.md](ROADMAP.md).
