# Phase 3 — Audit Triage

Source: `tools/audit/findings-pilot.json` (15 templates).
Goal: separate root causes from symptoms; rank fixes by leverage (templates affected).

---

## Tier A — Engine bugs with massive blast radius

### A1. `style.text_align` is silently dropped — renderer reads `style.align`
- **Symptom**: receipt prices overlap item names; flight number stacks on airline name; centered captions appear left-aligned.
- **Root cause**: `src/renderer/layer-renderers.ts:316` — `const anchor = style.align === ...`. Schema (`src/schema/types.ts:151`) also calls the field `align`, not `text_align`. But **3,636** template occurrences of `text_align` exist across `src/` + `public/templates/builtin/`. Templates were authored against `text_align`; renderer never sees them.
- **Blast radius**: every template that uses right- or center-aligned plain text. Estimated 200+ templates.
- **Fix**: accept either `align` OR `text_align` in `TextStyle` (preferring `text_align` since that's the dominant authored form). One-line change in renderer + type widening; templates stay as-is.
- **Risk**: low. Pure additive — existing `align: 'right'` still works.

### A2. Markdown in `rich_text` layers renders as raw `<pre>` source in static view
- **Symptom**: report titles show literal `**Marketing Funnel Analytics**` with asterisks.
- **Root cause**: `src/renderer/layer-renderers.ts:931-940` — when `format === 'markdown'`, the renderer stashes the source in `dataset.markdownSrc` and emits a `<pre>` with the unparsed text. Comment says *"marked.js renders this in report runtime"* — so markdown is only resolved in the interactive Mode B runtime, not at design-canvas render time.
- **Blast radius**: every report-style template (~41 reports + ~30 mixed dashboards/decks) that puts markdown in a `rich_text` layer.
- **Fix**: parse markdown inline at render time (we already lazy-load `marked` for `text` layers with `content.type === 'markdown'` at line 275). Reuse that path.
- **Risk**: medium. Need to verify report-runtime path doesn't double-render after we pre-render.

### A3. Interactive chart/table layers show `[Chart: bar]` / `[Table loading…]` placeholders in design view
- **Symptom**: report templates have empty boxes labeled "[Chart: bar]" instead of a visualisation.
- **Root cause**: `renderInteractiveChart` (line 862) and `renderInteractiveTable` (line 887) emit placeholders only; actual rendering is deferred to report runtime (Plotly/Tabulator).
- **Blast radius**: every data-viz template (~30-40 reports/dashboards).
- **Fix options**:
  - (a) Render a static SVG chart from the bound data at design time (heavier — adds Vega-Lite or custom SVG charting).
  - (b) Render a styled neutral placeholder showing the chart type + bound data summary, instead of bracketed text.
  - (c) Use the existing non-interactive `renderChart` path when `data_ref` resolves at render time.
- **Recommended**: start with (b) — far cleaner visual than the bracketed placeholder, low risk. Tackle (c) in Phase 6 if needed.
- **Risk**: low for (b).

---

## Tier B — Template authoring patterns to audit

### B1. Stacked text layers (no shared anchor)
- **Examples**: receipt items (name + price both `x: 40`, expect price right-aligned), boarding pass airline row, slide-title subtitle.
- **Relation to A1**: most of these "overlap" findings should self-heal once A1 lands. Re-render the pilot batch before treating them as separate fixes.

### B2. Image layer with no `src` renders the alt text inside a white box
- **Symptom**: children's-book cover shows `[ cover illustration ]` literal text inside a white rect.
- **Status**: not yet root-caused (could be intentional placeholder for slot-fill, but the white background clashes hard with template themes). Low priority — defer to Phase 6 per-template pass.

### B3. Icon sizing inconsistencies (wedding hearts: 3-4px specks)
- **Status**: per-template authoring choice, not an engine issue. Phase 6.

---

## Tier C — Per-template visual polish

| ID | Issue | Phase |
|---|---|---|
| `tmpl-childrens-book` | Theme mismatch (dark surface + red gradient on a children's book) | 6 |
| `tmpl-wedding-photo-timeline` | Low-contrast table headers, tiny heart accents | 6 |
| `tmpl-podcast-cover-art` | Mic body has stripes that look like a render artefact | 6 (verify after A1) |

---

## Phase 4 plan

Apply A1 → A2 → A3 in that order. Re-render pilot batch after each to confirm gains.

| Fix | Files touched | Templates auto-fixed (est.) |
|---|---|---|
| A1 `text_align` alias | `types.ts`, `layer-renderers.ts` (1 line each) | 200+ |
| A2 inline markdown render | `layer-renderers.ts` (rich_text branch) | 30-50 |
| A3 styled chart placeholder | `layer-renderers.ts` (makeForeignObject + chart/table fns) | 30-40 |

Total expected impact on the 432 catalog: meaningful visual improvement on ~half of templates.
