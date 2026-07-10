# GAP-ANALYSIS.md — Expectation vs Current Condition
# 2026-07-07 · v0.1.0 baseline · verified against src AND live-tested

> Method: expectations ([EXPECTATIONS.md](EXPECTATIONS.md)) vs code audit of
> `src/mcp`, `src/renderer`, `src/export`, `src/editor`, `src/fs`, `src/themes`,
> **then empirically verified on the live deployment** (MCP end-to-end runs +
> Playwright against the live editor; test fixture:
> `gap-audit/designs/image-src-matrix.design.yaml` — keep it, it's the WP-1
> acceptance repro). Severity: 🔴 blocks the product bar · 🟠 hurts daily use ·
> 🟡 polish. "Next" = the concrete first action; work packages in [ROADMAP.md](ROADMAP.md).
>
> Lesson from the live pass: **the docs were wrong in BOTH directions** — the
> asset hole is deeper than coded-audit suggested (silent blank even on the
> happy path), while several "missing" editor features already exist
> (UX_ROADMAP was stale). Verify against the live product before planning.

---

## 1. Assets + file system — ~~THE structural gap 🔴~~ → **SHIPPED 2026-07-07**

> Closed by commits 7376445 · 1ff5e7e · 43907f3 (WP-1.1…1.4 + editor side),
> live-verified on the deployed container against this fixture. What shipped:
> `manage_design` ops `asset_add`/`asset_list`/`asset_delete` (21 tools
> unchanged) with dims + dominant colors + luminance + alt; HTTP upload
> `POST /__project_files/<project>/assets/<kind>/<file>`; ONE resolver for
> preview + export (data-URI embed, byte-sniffed mime) covering image layers
> AND image fills; NO-SILENT-BLANKS (placeholder + note everywhere);
> `diagnose_design` image audit (unresolvable/distorted/upscaled); `assets`
> guide section; editor maps relative srcs through the authed mount and
> drops/pastes upload to project assets instead of inlining base64.
> Remaining nice-to-haves: `extract_reference {store:true}`, project fonts
> (WP-1.6), `_shared` cross-project library, editor asset panel, `$project.*`
> tokens. The matrix below is the PRE-fix record, kept for history.

Asset handling WAS a first-class *concept* with **no ingest path and no model
surface** — and live testing showed rendering broken even past that.

**Live-verified src matrix (2026-07-07, `gap-audit/image-src-matrix`):**

| `src` variant | render_preview | export PNG/SVG | editor canvas |
|---|---|---|---|
| `assets/…`, file missing | blank, **no placeholder** | placeholder + note | broken-image icon |
| `assets/…`, file **exists** | blank | **SILENT BLANK — no note** (existence check passes, nothing embeds the file for resvg) | broken-image icon (relative URL hits the SPA → `text/html` 200) |
| invalid `data:` URI | silent blank | silent blank | broken |
| valid `data:` URI | ✓ | ✓ | ✓ (but base64 lives in the YAML) |
| `https://` URL | blank, no note | **silent blank, no note** | ✓ loads |

Three traps that upgrade the severity beyond the code audit:
1. **The happy path is the worst path** — a real file in `<project>/assets/images/`
   passes `flagMissingImages()` (so no placeholder, no note) yet still exports
   a blank hole. There is currently NO working way to put a project photo into
   a deliverable except inlining base64 into the YAML.
2. **The engine steers models into the trap** — `add_layers` notes literally
   recommend "Use an https:// URL", which renders in the editor and silently
   vanishes from every server export. Looks-right-in-editor, blank-in-PDF.
3. **Preview ≠ export** — `render_preview` skips the missing-asset pass
   entirely, so a model that dutifully previews still can't see the problem.

Verified working foundation: resvg 2.6.2 renders `data:` URIs fine (both
`href` and `xlink:href`) — the WP-1.3 embed-at-export approach is sound.

Code-audit state (still true):

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
| `src:"assets/…"` doesn't render ANYWHERE (live-confirmed): editor gets SPA HTML at the relative URL; preview + export leave the relative href for resvg, which can't resolve it → silent blank even when the file exists | 🔴 | one resolver used by canvas + preview + export: rewrite (editor) / data-URI-embed (server); preview MUST share it (WP-1.3) |
| No unresolvable-src warning in preview, and none at export when the file exists / src is https or a bad data: URI — silent blanks | 🔴 | "no silent blanks" invariant: placeholder + note in preview AND export for every src the renderer cannot produce pixels for (WP-1.3/1.4) |
| `add_layers` note text actively recommends https:// srcs that exports can't render | 🟠 | reword the note now (1-line fix); https ingest lands with WP-1.2 |
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
| ~~Locked-group children opaque to `edit_layer`/`inspect`~~ **SHIPPED 2026-07-07** — inspect recurses (children carry `parent` + inherited `locked`); update on a locked child returns the exact unlock→edit→re-lock recipe; live-verified | ✓ | done (WP-3.2, commit 7376445) |
| ~~Free-text hints with pre-consolidation tool names~~ **SHIPPED** — prose hints rewritten to consolidated forms (`manage_design {op:"inspect"}` etc.) | ✓ | done (WP-3.2) |
| append_page renames on existing page_id — no in-place page replace; deck fixes = full rebuild | 🟠 | make same-page_id append an explicit replace (WP-3.3) |
| Model-class budget presets scattered (MCP.md table only) | 🟡 | INTEGRATIONS.md per-client presets (WP-3.4, docs) |

## 4. Editor / studio 🟠 — live audit REVERSED half the backlog

Playwright pass against the live editor (2026-07-07). **Already shipped,
contrary to UX_ROADMAP:** alt-click cycles stacked layers + alt-drag resizes
from center (both advertised in Quick Tips), click-through selects nested
children directly — even inside a LOCKED group (properties panel opens the
child; layers panel shows the lock), multi-select draws a common bbox with
handles + a floating ops toolbar + "Save selection as component", a
BOOLEAN / MASK panel exists (Clip Mask intersect / Release Mask), blend modes
+ Flip H/V + Link URL are in the properties panel.

**2026-07-10 deep sweep** (5 viewports, model-level geometry): the 07-07
"group transform is FAKE" finding was itself a measurement artifact — the
probe measured minimap clones, not the model. Corner-drag on an ad-hoc
multi-select scales EVERY layer proportionally around the group origin and
one undo restores all (verified: title 900×160→1216×215, caption 840×48→
1135×64, both ×1.353). Also already-working: Alt=resize-from-center
(center preserved exactly), per-corner radius toggle, ⌘K palette, marquee,
Add Page → strip appears, inline text edit, first paint clean at +200ms.

Real remaining gaps (all live-verified 2026-07-10):

| Gap | Severity | Evidence |
|---|---|---|
| TABLET 768–1023 broken: left overlay OPEN on load covering canvas; 276px page hScroll (parked `translateX(105%)` props panel counts toward scrollWidth); view not fit (~-235px pan) | 🔴 | B8 — load at 820×1024 |
| NO right-click context menu — right-click selects the layer, no menu ever appears | 🟠 | B10 |
| Floating align toolbar overlaps ruler, top half clipped under formula bar, on every selection at every desktop width | 🟠 | B9 |
| Multi-select properties panel = BOOLEAN/MASK only — no Group/Ungroup button, no align/distribute, no bbox X/Y/W/H (align exists ONLY in the clipped floating bar; Ctrl+G undiscoverable) | 🟠 | 14.7 |
| Fill UI offers Solid · Linear · Radial · None ONLY — no Pattern, no Image fill (engine renders both; models can author them, humans can't) | 🟠 | properties panel dump on a rect |
| No Assets panel — activity bar = Layers · Files · Components · Icons · Find&Replace (+ right: Properties · Data · Scripts · Colors · Animate · Timeline · Issues · A11y) | 🟠 | pairs with WP-1 (asset ops shipped, no GUI) |
| 9 toolbar buttons <32px tap target incl. on phones | 🟡 | B11 |
| Font Family input empty for token/default fonts | 🟡 | B12 |
| Full path booleans (union/subtract/…) beyond clip-mask unverified; SVG-import-to-layers, constraints/pinning still open | 🟡 | WP-4 rest |
| Cold load ≈3.3–4.4s to DCL over network (target <1s; TLS+latency inflates — needs a bundle/waterfall pass before judging) | 🟡 | audit `load.msToDCL` |

Next: WP-4 (re-scoped 2026-07-10); editor dist now builds locally (~8s).
**Process note:** UX_ROADMAP rows must be re-verified against the live editor
before being roadmapped — AND geometry claims must be measured at MODEL level
(`__folio.state.get().design`), never via DOM/minimap bboxes: both 07-07
directions of error came from DOM measurement.

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

**120B smoke run (2026-07-10, nemotron-3-super-120b via harness-claude,
1 case, asset workflow):** the ASSET PIPELINE passes blind end-to-end —
model found the uploaded photo via asset_list, placed it with fit, export
embedded it (4 hero instances render). Composition FAILED the floor:
"What's Inside" section appended 5×, offer block 2× (thrash), document
height ballooned 1080×1350 → 1080×4826 despite an explicit Instagram-
portrait ask, mid-page text collisions survived seal. New engine items →
**WP-3.5 seal-time duplicate-section collapse** (same normalized text
block ≥2× overlapping/stacked → keep first) and **WP-3.6 requested-ratio
hardening** (poster + explicit aspect in brief → engine refuses doc-height
balloon, reflows instead). Repro: roastery-launch project on the live
container. Also unexplained: espresso-hero placed at icon size renders the
PLACEHOLDER glyph while the big placements render fine — repro before
diagnosing.

---

## What to do next — priority order (updated 2026-07-07 after the ship wave)

~~1. WP-1 Asset System~~ **SHIPPED + live-verified** (7376445 · 1ff5e7e ·
43907f3). ~~WP-3.2 locked-group + prose hints~~ **SHIPPED**.

1. **WP-4 editor UX rescue batch** (re-scoped 2026-07-10) — tablet 768–1023
   rescue (🔴) → context menu → align-toolbar de-clip → multi-select panel
   (Group + align + bbox) → touch tap targets → then pattern/image fill UI +
   asset panel. ~~True group transform~~ verified already working.
2. **WP-3.1 model-floor harness run** — proves the local-model claim
   end-to-end via claude.lab.casava.space (120B available; swap to another
   free model if needed) + vision review. Include the asset workflow
   (asset_add → place).
3. **WP-2 design-power resumption** + photo-first archetypes (expectation 03
   §8.5 — hero-photo posters now unblocked by the asset system).
4. **WP-1 leftovers (nice-to-have)** — extract_reference store:true, project
   fonts, `_shared` library, WP-3.3 append_page replace.
5. **WP-5/6 polish** — PPTX text, browser PDF, scripted regression replay,
   asset round-trip in CI (WP-6.1 — unit tests shipped; wire into CI job).

Full work packages with acceptance criteria: [ROADMAP.md](ROADMAP.md).
