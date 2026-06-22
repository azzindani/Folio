# Folio × Open Design — Capability Comparison & Adoption Report

> Comparison of **Folio** (this repo) against **Open Design** by nexu-io
> ([github.com/nexu-io/open-design](https://github.com/nexu-io/open-design), Apache-2.0,
> release 0.10.0). Goal: digest what Open Design does, find features Folio can
> **adapt**, and rank them by value × fit. Surveyed 2026-06-22 against a shallow
> clone (151 design-systems · 155 skills · 109 design-templates · 13 craft files).

---

## 1. TL;DR

The two projects share a thesis — *"an LLM/coding-agent composes designs, the
filesystem is the product, MCP is the bridge"* — but sit at **different layers of
the stack**:

| | Folio | Open Design |
|---|---|---|
| **What it is** | A **render engine + spec format**. YAML → SVG/HTML/PDF/animation. The `.design.yaml` is the product. | A **design workspace + knowledge base**. Native desktop app (macOS/Win) that drives *coding agents* to emit real HTML/CSS/PPTX/MP4 artifacts in a sandboxed iframe. |
| **Output medium** | SVG-in-HTML, compiled from a typed spec by Folio's own renderer. | Real HTML/CSS/JS artifacts written by the agent, previewed in an iframe. |
| **Core asset** | The **engine** (parser, shorthand, token resolver, spatial finalize, 49 MCP tools). | The **content library** (151 brand `DESIGN.md` systems, 13 `craft/` rulebooks, 155 skills, 109 templates) + a model router (AMR). |
| **Strength** | Deterministic spatial correctness, one render path, rich export matrix, self-hosted MCP. | Curated design *knowledge* + anti-AI-slop linting + brand contracts the agent reads. |

**The takeaway:** Open Design's **engine/app layer does not port** to Folio (different
output medium, Electron app, model router — all out of scope). But its **knowledge
layer is gold and ports cleanly** — and it targets the exact problem Folio has logged
for months (the "AI look", see `project-folio-ai-look-diagnosis`). Folio already has
the *spatial* engine; Open Design has the *taste* rulebook. Adopting the latter is
high-value, low-risk, and license-compatible.

---

## 2. Side-by-side capability map

✅ have · 🟡 partial · ❌ none

| Capability | Folio | Open Design | Notes |
|---|:--:|:--:|---|
| Spec/render engine (own) | ✅ | ❌ | Folio compiles YAML→SVG; OD delegates to the agent's raw HTML. Folio is **stronger** here. |
| Deterministic spatial finalize (fit/clamp/collision/legibility) | ✅ | ❌ | Folio's `engine-*` passes; OD relies on agent + linter only. **Folio-unique.** |
| Layer-typed primitives (40+ types) | ✅ | 🟡 | Folio: rect…mermaid…interactive_table. OD: whatever HTML the agent writes. |
| Interactive components (button/modal/tabs/filter_bar/…) | ✅ | ✅ | Both. Folio bakes them from spec; OD emits raw HTML. |
| Data binding / live data artifacts | ✅ | ✅ | Folio reports (`$data.*`/`$agg.*`); OD "Live Artifact". |
| Charts | ✅ | ✅ | Folio: Vega-Lite + Chart.js + Plotly. OD: agent-authored. |
| Animation → MP4/GIF/WebM/Lottie | ✅ | ✅ | Folio `animation-export.ts`; OD "HyperFrames". Parity. |
| Decks / presentations | ✅ | ✅ | Folio `presentation-assembler` (PDF); OD Deck → **PPTX**/PDF. OD has PPTX, Folio doesn't. |
| PDF export (vector text) | ✅ | ✅ | Folio bundled-TTF vector PDF; OD via Chromium. |
| Visual editor (drag/resize/panels) | ✅ | 🟡 | Folio has a full Monaco+canvas editor; OD is iframe-preview + comment queue, not a layer editor. **Folio stronger.** |
| MCP server (stdio + HTTP, auth) | ✅ | ✅ | Both. Folio: 49 tools, JWT/OAuth. OD: `od mcp install <agent>`. |
| Brand **design-system** library | 🟡 | ✅ | Folio: 17 token themes. OD: **151 prose+token `DESIGN.md`** contracts. **OD far ahead.** |
| **Craft knowledge** rulebooks (color/type/a11y/anti-slop) | 🟡 | ✅ | Folio: scattered in MCP steering + `craft/` design skills marketplace. OD: 13 dense, opt-in, partly **auto-linted**. **OD ahead.** |
| **Anti-AI-slop linter** (auto-checked) | 🟡 | ✅ | Folio: `diagnose_design` + legibility passes. OD: `lint-artifact.ts` blocks 7 cardinal sins by rule-id. **Adaptable.** |
| Skills / recipe catalog | 🟡 | ✅ | Folio: presets + templates + guide. OD: 155 skill catalog entries. |
| Native desktop app | ❌ | ✅ | OD Electron app. Out of scope for Folio (server+web). |
| Model router (multi-provider) | ❌ | ✅ | OD "AMR". Out of scope — Folio is model-agnostic via MCP. |
| Plugin runtime | 🟡 | ✅ | Folio: component/template injection. OD: 261-plugin runtime. |

**Where Folio already wins:** the engine itself — typed spec, deterministic spatial
math, one render path (`renderEntry`), the full export matrix, and a real layer editor.
We should not chase OD's app/router/plugin-runtime layers; they're a different product.

**Where Open Design wins:** curated, machine-consumable **design taste** — brand
contracts and craft rulebooks the model reads *before* it designs, plus a linter that
catches the slop *after*. This is precisely Folio's open gap.

---

## 3. What Folio can adapt — ranked

Each item notes **value**, **fit** (how cleanly it maps onto Folio's YAML/SVG/MCP
architecture), and a concrete **how**.

### 🟢 A1 — Vendor the `craft/` knowledge rulebooks as MCP guide modules · value HIGH · fit HIGH

OD's `craft/` is 13 brand-agnostic, dense rulebooks (typography, typography-hierarchy,
color, anti-ai-slop, state-coverage, animation-discipline, accessibility-baseline,
laws-of-ux, form-validation, rtl-and-bidi, …). They encode *universal* craft —
"ALL CAPS always needs ≥0.06em tracking", "≤2 visible accent uses per screen",
"neutrals are 70–90% of pixels", "one dominant entry point per surface". This is
exactly the knowledge Folio's steering tries to convey ad-hoc today.

**How for Folio:** add a `src/mcp/craft/` directory of small markdown/TS rule modules.
Wire them into `get_engine_guide` so the guide injects **only the modules relevant to
the requested design kind** (poster → color + typography + anti-slop; report → +
state-coverage + laws-of-ux + a11y; deck → + animation-discipline). OD's
`od.craft.requires: [...]` opt-in pattern is the model — token-cost-aware, additive.
Folio's payoff is immediate: the model writes better specs because it carries the rules,
not because the engine post-fixes them (stays true to CLAUDE.md §0.4 — model designs,
engine assists). Licence: craft content is MIT (refero_skill) re-adapted by OD under
Apache-2.0; both permissive — vendor with attribution.

### 🟢 A2 — An "AI-slop" lint pass in `diagnose_design` · value HIGH · fit MEDIUM-HIGH

OD's `apps/daemon/src/lint-artifact.ts` flags the **seven cardinal sins** with stable
rule-ids: `ai-default-indigo` (exact Tailwind indigo hexes as accent), `purple-gradient`
+ `trust-gradient` (two-stop purple→blue hero), `emoji-icon` (✨🚀🎯 as feature icons),
`sans-display` (sans on display when a serif is bound), `invented-metric` ("10× faster"),
`filler-copy` (lorem ipsum), plus P1s `all-caps-no-tracking`, `accent-overuse`
(`--accent` 6+ times), `external-image`, `raw-hex` (>12 raw hexes).

**How for Folio:** Folio already has `diagnose_design` + `design-lint` + the
`engine-finalize-legibility` pass — this is a natural **new lint category, not new
infrastructure**. Translate the HTML-targeted checks to Folio's spec model: scan
expanded-layer fills/colors/fonts/text. Indigo-accent, two-stop trust gradient,
emoji-as-icon, invented-metric, filler-copy, ALL-CAPS-without-tracking, and accent
overuse all map directly to layer/fill/text inspection. Surface as `diagnose_design`
findings (and optionally auto-repair via the existing `patch_design` path). Caveat:
some OD checks are HTML-DOM-specific (`missing-section-anchor`, `scroll-into-view`) and
don't apply to SVG specs — skip those.

### 🟢 A3 — Richer brand "design-system" format (the 9-section `DESIGN.md`) · value HIGH · fit MEDIUM

OD ships **151** real-site-analyzed brand contracts (apple, linear, notion, airbnb,
stripe, …). Each `DESIGN.md` is a 9-section prose+token document: visual atmosphere,
full color-role palette, a complete **type ladder** (size/weight/line-height/tracking
per role), spacing, components, section rhythm. Folio's themes (`src/themes/builtin.ts`,
17) are token-only — palette + fonts, no atmosphere/ladder/rhythm.

**How for Folio:** two tiers.
1. *Cheap win:* extend Folio's theme schema with optional `atmosphere`, `type_ladder`,
   and `section_rhythm` fields, and let `apply_theme`/`get_engine_guide` surface them so
   the model inherits a real ladder instead of guessing sizes. This directly attacks the
   "samey / centered / one-size headline" failures logged in `project-folio-frontier-freehand`.
2. *Bigger:* import a curated subset of OD's `DESIGN.md` systems (Apache-2.0, attribute)
   as Folio themes + composition briefs. Their token blocks are already CSS custom
   props — a converter to Folio's YAML theme tokens is straightforward. Start with 10–15
   distinctive brands to widen Folio's visual range without bloating the bundle.

### 🟡 A4 — The "three-axis" mental model · value MEDIUM · fit HIGH

OD cleanly separates **shape** (`skills/`: landing, dashboard, pricing) × **brand**
(`design-systems/`: the visual language) × **universal craft** (`craft/`: rules true
regardless of brand). Folio currently *mixes* all three inside MCP steering + presets.

**How for Folio:** reframe the guide along the same axes — **preset** (shape) × **theme**
(brand) × **craft** (universal). Mostly a docs/steering refactor (`get_engine_guide`,
`docs/DESIGN.md`), no engine change, but it makes the steering legible and additive
instead of a monolith, and it's the scaffolding A1/A3 slot into.

### 🟡 A5 — The "80/20 soul" principle + identifiability test · value MEDIUM · fit HIGH

OD's anti-slop doc codifies a memorable rule: **~80% proven patterns + ~20% distinctive
choice**, and a litmus — *"if someone outside the project can screenshot the artifact and
name the product, it has soul; if not, you shipped a template."* This is a crisp,
quotable framing of Folio's long-running anti-AI-look goal.

**How for Folio:** fold the 80/20 rule and the identifiability test into `get_engine_guide`'s
opening philosophy block and into the harness diversity eval (`eval_diversity.py`,
see `project-folio-harness-diversity-redo`) as a scoring heuristic.

### 🟡 A6 — PPTX deck export · value MEDIUM · fit MEDIUM · OD parity gap

OD exports decks to **PPTX**; Folio's `presentation-assembler` does self-contained HTML +
PDF but no PPTX. PPTX is the one export format OD has that Folio lacks.

**How for Folio:** a `pptx` target in `src/export/` (e.g. via `pptxgenjs`, or hand-rolled
OOXML) mapping each Folio page → a slide with text/image/shape shapes. Medium effort,
clear demand (editable decks). Lower priority than the knowledge items.

### ⚪ A7 — "Live Artifact vs Normal Artifact" naming · value LOW-MEDIUM · fit HIGH

OD distinguishes a **Live Artifact** (refreshable, data-bound, stores source+preview)
from a **Normal Artifact** (static entry file + manifest). Folio already *does* both
(static designs vs data-bound reports) but doesn't name the split. Adopting the vocabulary
+ a small manifest sidecar would clarify the report-vs-design distinction in the library
and MCP returns. Cosmetic but cheap.

---

## 4. What does NOT port (explicitly out of scope)

- **Native desktop app** (`apps/desktop`, Electron) — Folio is server + web editor by design.
- **AMR model router** — Folio is model-agnostic via MCP; routing is the client's job.
- **Plugin runtime** (`packages/plugin-runtime`, 261 plugins) — Folio's component/template
  injection covers the realistic need; a general plugin VM is a different product.
- **Raw-HTML artifact generation in a sandboxed iframe** — Folio's value *is* the typed
  spec + deterministic render; emitting raw agent HTML would discard the spatial engine.
  (Folio's Mode B interactive HTML already covers the legitimate interactive-output case.)
- **Multi-agent parallel "design team" sessions / AGUI** — orchestration is the harness's
  job (Folio already integrates with Hermes/OpenClaw via MCP).
- **The 155-skill catalog as-is** — most are thin pointers to upstream repos, not runnable
  content; only the `craft/` subset is directly valuable.

---

## 5. Licensing

Open Design is **Apache-2.0**. Its `craft/` content is adapted from the **MIT** `refero_skill`
project (© Refero Design). Both licences are permissive and compatible with vendoring into
Folio **with attribution** (retain the upstream credit lines OD already carries, and note
Apache-2.0 / MIT provenance in any vendored file header + `docs/`). The `DESIGN.md` brand
systems are Apache-2.0 in the OD repo; reuse is permitted with attribution — but they
describe *third-party brands* (Apple, Airbnb, …), so treat them as **inspiration/derived
analysis**, not licensed brand assets, and label Folio themes accordingly (e.g.
"inspired-by-apple", as OD itself does: *"Design System Inspired by Apple"*).

---

## 6. Recommended adoption order

1. **A1 — craft modules** (`src/mcp/craft/` + `get_engine_guide` injection). Highest
   value, lowest risk, reuses existing wiring. Directly closes the AI-look gap.
2. **A2 — AI-slop lint pass** in `diagnose_design`. Pairs with A1: A1 teaches the rules,
   A2 catches violations. Stable rule-ids from `lint-artifact.ts` are a ready spec.
3. **A4 — three-axis guide refactor**. Docs/steering only; makes A1/A3 land cleanly.
4. **A3 — richer theme format** (atmosphere + type ladder + section rhythm), then import
   a curated 10–15 `DESIGN.md` subset as themes. Widens visual range.
5. **A5 — 80/20 soul rule** into guide + diversity eval. Cheap, reinforces the above.
6. **A6 — PPTX export** when editable-deck demand justifies the export work.
7. **A7 — artifact vocabulary** as a light cleanup whenever the library/report split is touched.

**Net:** Folio keeps its engine edge and borrows Open Design's *taste layer* — the
brand contracts, the craft rulebooks, and the anti-slop linter — to make the model
design better up front and to catch slop after, without compromising the
"model-designs / engine-assists" principle.

---

## 7. Implementation status (2026-06-22)

The taste layer (A1/A2/A4/A5) + the A3 schema shipped — all MCP-side, no new
dependency, deployable via `docker cp src` (no editor rebuild).

| Item | Status | Where |
|---|---|---|
| **A1** craft rulebooks + guide injection | ✅ Shipped | `src/mcp/engine/craft.ts` — 5 modules (`anti_slop`, `color`, `type`, `ux_laws`, `a11y`) + `craft` index; `craftFor(kind)` scales them by design type. Reachable via `get_engine_guide({section:…})` (enum extended in `tier1/registry.ts`); `quick_ref` points at them. |
| **A2** AI-slop lint pass | ✅ Shipped | `src/mcp/engine/ai-slop-lint.ts` — `lintAiSlop()` flags indigo accent, two-stop trust gradient, emoji-as-icon, invented metrics, filler copy, all-caps-no-tracking, accent overuse. Folded into `diagnose_design` findings (`code:"ai_slop"`) + `add_layers` review notes. |
| **A4** three-axis model | ✅ Folded into A1 | The `craft` index frames preset(shape) × theme(brand) × craft(universal). |
| **A5** 80/20 soul + identifiability test | ✅ Folded into A1 | In the `craft` index; quotable in the guide. |
| **A3** richer theme format | ✅ Schema + exemplars | `ThemeSpec` gained optional `atmosphere` / `type_ladder` (`TypeLadderRole[]`) / `section_rhythm` (non-breaking, non-rendering). Populated for `dark-tech`, `editorial-cream`, `swiss-international`. `apply_theme` now returns a `brand` block + a "Brand voice" progress note so the model inherits the voice + an authored type ladder. |
| A3 — `DESIGN.md` bulk import | ✅ Shipped | `tools/import-design-systems.mjs` parses OD `DESIGN.md` (palette→roles with contrast guards, font families → bundled substitutes, the type-ladder table, atmosphere, rhythm) → `src/themes/brand-pack.ts` (12 "inspired-by" themes: apple, linear, notion, stripe, vercel, airbnb, spotify, github, figma, slack, nike, mono), merged into `BUILTIN_THEMES`. Re-runnable. |
| **A6** PPTX export | ✅ Shipped | `src/export/pptx-export.ts` — a **dependency-free** PPTX writer (tiny STORED-zip + OOXML), image-per-slide via the existing resvg path. Wired as `export_design` `format:"pptx"`. Deploys via `docker cp` (no new dep / image rebuild). Validated with `python-pptx` + `unzip -t`. Native editable-text export remains a future enhancement. |
| **A7** artifact vocabulary | ⏳ Deferred | Low value; revisit when the library/report split is next touched. |

Tests: `craft.test.ts` + `ai-slop-lint.test.ts` (new) green; 408 MCP-engine tests pass;
`tsc` + `eslint` clean; every touched file ≤700 lines.
