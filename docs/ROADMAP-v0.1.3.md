# ROADMAP-v0.1.3.md — "Reachable"
# Advanced capability for frontier models · MCP-reachable · production-real
# Written 2026-07-20 · chain: EXPECTATIONS → REQUIREMENTS → GAP-ANALYSIS → ROADMAP → **this**

> Binds to [ROADMAP.md](ROADMAP.md) ground rules 1–6. Rule 1 especially:
> **MCP tools stay EXACTLY 21.** Everything below lands as a new `op`, a new
> field on an existing op, or a new `get_engine_guide` section. Zero new tools.

---

## 0. PREMISE — why this release exists

v0.1.0–0.1.2 built for the *floor*: make a blind, small, local model produce a
design that renders. That floor holds. This release builds the *ceiling*: give a
frontier model capability it cannot get anywhere else — motion, image
processing, mark construction — without widening the tool surface it has to
reason about.

Three findings set the scope. All three are **capability that exists in the
repo but cannot be reached from a live MCP session.**

```
F1  MOTION IS DEAD IN PRODUCTION
    docs say shipped:   UX_ROADMAP.md:232  | 12.5 Export GIF/WebM/MP4 | ✓ |
    docs say shipped:   TOOLS.md:167       animation → export(gif|mp4|webm)
    production says:    $ docker exec folio sh -lc 'which ffmpeg'  → NO_FFMPEG
                        $ ls node_modules/puppeteer                → NO_PUPPETEER
    code says:          animation-export.ts:83
                        if (!puppeteer && !_factory)
                          return { success:false, error:'puppeteer not installed' }
    ⇒ animation(op:export) hard-fails on folio.casava.space, always.
    ⇒ 4 tests in animation-export.test.ts fail on any host that HAS ffmpeg
      (they asserted the no-ffmpeg fallback while trusting the machine).

F2  IMAGE PROCESSING IS EDITOR-ONLY
    src/utils/bg-remover.ts EXISTS + works — flood-fill from corners, tolerance
    + feather. But it is browser-bound (document.createElement('canvas')) and
    referenced from exactly one place: ui/panels/properties-panel.ts:389.
    ⇒ A model over MCP cannot remove a background. A human in the editor can.
    ⇒ Meanwhile expectations/03-assets-filesystem.md:156 declares image editing
      OUT OF SCOPE. Doc and code disagree. This release picks a side: IN.

F3  NO MARK/IDENTITY GEOMETRY AT ALL
    Logos exist only as uploaded assets. Nothing helps a model CONSTRUCT one —
    no optical centering, no clearspace, no scale-survival test.
```

### Non-goals

```
✗ New MCP tools (rule 1) — 21 stays 21
✗ A "logo generator" that stamps marks from presets — CLAUDE.md §0.4: preset
  recipes make outputs typical + samey. Every AI logo tool proves it.
  We ship the MATH that makes a model-drawn mark hold up. Not the mark.
✗ ffmpeg / Chromium as runtime dependencies — 4g container, bun --smol,
  no build step. Anything requiring a 300MB binary is the wrong design.
✗ sharp / native image deps — same reason. Pure TS or nothing.
✗ Raster video (mp4/webm) as the PRIMARY motion path — keep the existing
  ffmpeg path as an opportunistic upgrade, never the only route.
```

---

## WS-A · Motion that survives production ★ highest value

**Problem:** the only motion export route requires two binaries the deployment
does not have and should not have. A frontier model can author keyframes today
(`animation(op:keyframe)`) and then cannot get a file out.

**Insight:** Folio renders SVG. SVG animates natively — SMIL + CSS keyframes —
with no encoder, no browser, no binary. A self-contained animated SVG/HTML is
*better* than a GIF for most uses (vector, tiny, infinitely crisp) and is
producible by pure string assembly in the existing render path.

### A1 — `animation(op:export)` gains binary-free types

```
type: 'svg'   → self-contained animated SVG (SMIL/CSS), no deps         ← NEW
type: 'html'  → single-file HTML, CSS keyframes + optional loop control ← NEW
type: 'gif'   → pure-TS LZW encoder over resvg-rendered frames          ← NEW PATH
type: 'mp4' | 'webm' → unchanged ffmpeg path, now explicitly OPPORTUNISTIC
```

The GIF path is the interesting one: `@resvg/resvg-js` is already a dependency
and renders SVG→PNG server-side. Render N frames by advancing the keyframe
clock, quantize to a 256-colour palette (median-cut), LZW-encode to GIF89a.
~400 lines of pure TS, zero new deps, works in the container today.

```
Accept:
  ✓ animation(op:export, type:'svg'|'html'|'gif') produces a real file on the
    LIVE container (no ffmpeg, no puppeteer present)
  ✓ mp4/webm still work where ffmpeg exists; degrade with a CLEAR next_action
    telling the model to use svg/gif instead — never a bare failure
  ✓ GIF ≤ 2MB for a 1440×1440 · 3s · 12fps loop
  ✓ file ≤700 lines → src/export/gif-encode.ts + gif-quantize.ts siblings
```

### A2 — `animation(op:motion)` — the authoring verb ← NEW OP

Today a model must hand-write a keyframe per layer per time. That is the
assembly language. `op:motion` is the sentence:

```
animation(op:'motion', design_path, page_id?, layer_ids?,
          preset:'stagger_up'|'cascade'|'draw_on'|'count_up'|'reveal_mask'|…,
          stagger_ms?, duration?, easing?)
```

It EXPANDS to real keyframes on real layers — inspectable, editable,
overridable. It is not a black box and it does not decide the design; it saves
the model 40 tool calls to express one intent. Same relationship shorthand has
to the render tree.

```
Accept:
  ✓ op:motion writes keyframes that animation(op:timeline) then displays
  ✓ every preset is expressible by hand — no preset does something the
    keyframe API cannot
  ✓ applying a preset to a locked group animates the GROUP, not children
    (matches the carousel authoring contract)
```

### A3 — hermetic animation tests

Fix the 4 failures. Stub the ffmpeg probe rather than trusting the host, and
assert BOTH branches (encoder present / absent) explicitly.

```
Accept: ✓ green on a box with ffmpeg AND without · no test reads the real PATH
```

---

## WS-B · Image processing reachable from MCP

**Problem:** `bg-remover.ts` works but only a human can trigger it.

### B1 — pure-TS raster path (no canvas, no sharp)

Lift the flood-fill out of the browser: a `decodePNG()` (Node `zlib.inflateSync`
+ unfilter, ~200 lines) and `encodePNG()` (deflate + CRC) pair, with the
existing corner-seeded flood-fill operating on a plain `Uint8ClampedArray`.
The editor keeps its canvas path; both call ONE shared algorithm.

```
Scope: PNG in / PNG out first. JPEG decode is a separate, larger question —
       defer it and return a clear "convert to PNG" hint rather than half-doing it.
```

### B2 — expose via `asset_add` — **zero new ops**

```
manage_design(op:'asset_add', …, process:{
  remove_bg: true | {tolerance?, feather?},
  trace:     true,          # → SVG via the existing imagetracerjs
  fit:       {w,h,mode:'cover'|'contain'}
})
```

Returns the processed asset plus what changed. `asset_add` already exists,
already takes a data-URI, already returns dims + dominant colours. This is a
new field on an existing op — the cheapest possible landing.

```
Accept:
  ✓ a model can upload a photo with a white background and place it on a
    coloured canvas with no halo, in ONE tool call
  ✓ dominant_colors recomputed AFTER processing (transparent pixels excluded —
    otherwise every cut-out reports "white" and mis-steers the palette)
  ✓ round-trips through the live container within the asset byte caps
  ✓ expectations/03 §9 amended — image editing moves IN scope, deliberately
```

---

## WS-C · Mark geometry — construct, don't generate

**Problem:** nothing helps a model build an identity that holds up.
**Anti-goal:** a logo generator. See non-goals.

### C1 — `get_engine_guide(section:'marks')` ← new section, free per rule 1

The construction knowledge a model lacks: optical vs geometric centering, why
a triangle must overshoot a circle's cap height, counter-shape balance,
stroke-weight compensation at small sizes, lockup spacing as a function of
x-height, clearspace = the mark's own unit.

### C2 — `diagnose_design` gains mark checks

The engine's honest job — measure what the model cannot see:

```
optical_center   — centroid-of-ink vs bounding-box centre; flags the classic
                   "play button looks left-heavy" error
scale_survival   — render the mark at 16/24/32/64/512px through resvg; report
                   which details vanish or blur into each other
contrast_check   — mark on light / dark / mid backgrounds, WCAG + perceptual
clearspace       — derive from the mark's own geometry, return the rule
```

### C3 — `themes(op:derive)` ← NEW OP

Extract a full theme (palette + type ladder + brand character) from a placed
mark or an asset's dominant colours, so an identity propagates through every
subsequent design instead of being re-typed per file.

```
Accept:
  ✓ a mark the model draws freehand gets measured, not replaced
  ✓ scale_survival catches a real failure on a deliberately over-detailed mark
  ✓ NO op returns a ready-made logo. If one does, it is out of scope.
```

---

## WS-D · Interactive HTML — depth over breadth

14 component kinds ship (`interactive-renderers.ts:91-104`). The gap is not
more kinds; it is that components cannot *compose* or hold real state.

```
D1  cross-component binding — a filter_bar drives a chart AND a table AND a KPI
D2  computed series — $agg over bound data feeding interactive_chart directly
D3  view state in the URL fragment — a shared link reopens the same filtered view
D4  new kinds ONLY where the vocabulary is genuinely absent: timeline_scrub,
    compare_slider, map (deferred if it needs a tile server — air-gapped rule)
```

Lower priority than A/B/C — the existing surface is good and the marginal
return is smaller. Ship if the release has room.

---

## WS-E · Carried-over debt (cheap, do alongside)

```
E1  document.dpi honored in vector PDF — ALREADY WRITTEN, uncommitted in tree,
    tests pass (export-pdf.test.ts green). An A2 poster at 150dpi currently
    exports 1.56× too large. Land it.
E2  WP-3.4 · per-client budget presets in INTEGRATIONS.md (docs only, cheapest
    open item in the whole chain)
E3  WP-3.1 · Gemma 3n E4B floor validation via tools/harness-suite/run_live.py
    — ranked #2 next in GAP-ANALYSIS.md:211. Confirms WS-A/B/C did not raise
    the floor's cost. Operator-assisted.
E4  ROADMAP.md header hygiene — WP-1.1/1.2/1.3/3.2 are shipped per
    GAP-ANALYSIS but still read as open. Strike them.
```

---

## ORDER + ACCEPT BAR

```
1. E1        land the DPI fix           (written, tested, 10 min)
2. A3        hermetic animation tests   (unblocks all A work)
3. A1        binary-free motion export  (the headline)
4. B1+B2     bg removal over MCP        (the most-asked capability)
5. A2        op:motion authoring verb
6. C1+C2     mark geometry
7. C3, D, E2 as room allows
8. E3        E4B floor re-validation    → then release
```

**Release bar (all must hold):**

```
✓ MCP tools = 21. Ops added: animation:motion · themes:derive. Nothing else.
✓ Every new capability demonstrated END-TO-END on the LIVE container —
  not just unit-tested. No ffmpeg, no puppeteer, no new native deps.
✓ Small-model floor unchanged: E4B ≥90% sealed, 0 blank posters.
✓ Every src file ≤700 lines · TS strict · no console.log · no TODOs
✓ CHANGELOG [0.1.3] written BEFORE tagging (release.yml awk-parses it)
✓ Diversity eval does not regress — CLAUDE.md §0.4 litmus: if outputs got
  more uniform, the change was wrong
```
