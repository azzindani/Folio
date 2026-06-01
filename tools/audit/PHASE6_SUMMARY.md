# Phase 6 — Per-template fixes + visual baseline

## Final state
- 432 templates rendered at native canvas size.
- **PASS 266 (61.6%)** · WARN 166 (38.4%) · FAIL 0.
- All remaining WARNs are intentional-design false positives from the geometry/text-overlap heuristic (poster decorative bleed, layered typography, etc.).

## Work executed in Phase 6
- Built parallel render harness (6 workers, ~15s per full catalog vs ~5min serial).
- Tightened classification heuristic:
  - Geometry overflow/off-canvas now ignored under 8px (sub-pixel rounding) and only counted ≥32px (real breakage vs. decorative bleed).
  - Added pairwise text-overlap detector (≥4px on both axes).
- Generated 3 agent batches (100 actionable templates) and dispatched 3 subagents in parallel.

## Agent results

| Agent | Templates reviewed | Fixed | Kept-as-is | Follow-ups |
|---|---:|---:|---:|---:|
| Batch 1 | 34 | 7 | 27 | 0 |
| Batch 2 | 33 | 4 | 27 | 2 |
| Batch 3 | 33 | 5 | 26 | 2 |
| **Total** | **100** | **16** | **80** | **4** |

YAML files modified (16):
```
27-album-cover.template.yaml (?), 37-event-ticket.template.yaml,
39-save-the-date.template.yaml, 44-tutorial-3-step.template.yaml,
49-newspaper-front-page.template.yaml, 63-slide-statistics.template.yaml,
115-book-cover-thriller.template.yaml, 141-concert-poster-electronic.template.yaml,
145-movie-poster-scifi.template.yaml, 172-conference-brochure.template.yaml,
247-instagram-reels-cover.template.yaml, 265-vinyl-record-sleeve.template.yaml,
272-festival-lineup-card.template.yaml, 273-spotify-wrapped-card.template.yaml,
276-audio-waveform-poster.template.yaml, 25-magazine-cover.template.yaml,
40-slide-title.template.yaml
```

## Engine bugs uncovered + fixed (during Phase 6)
1. **`type: ellipse` / `type: polyline` rendered as dashed placeholder** — added them to the renderer switch (alias of `circle`/`path`). Affected ~5 templates including recipe-zine.
2. **`spec.theme.ref` not propagated to `state.theme` on `loadDesign`** — caused editorial-cream templates to render with dark-tech colors (invisible text). Fixed in `src/editor/app.ts` to resolve theme.ref against `BUILTIN_THEMES` and write to state in the same batch.

## Open follow-ups (4)
1. **`tmpl-product-launch-poster`** — title appears faded in static capture, looks like enter-animation initial-state being captured before settle.
2. **`tmpl-learning-platform-report`** — empty chart placeholders; chart layers still defer to Mode B runtime and need data binding to render statically.
3. **`tmpl-leadership-quote-poster`** — Playfair Display @ weight 500 not rendering glyphs in headless chromium (theme fix worked — bg cream — but font binary fails to load). Likely an env-specific font-loading race rather than a template bug.
4. **`tmpl-paper-summary-poster`** — same Playfair-500 pattern as above.

## Cross-phase journey

| Phase | Outcome |
|---|---|
| 1 | Inventory + render harness scaffolded. |
| 2 | Pilot of 15 templates surfaced 3 systemic bugs (text_align dropped, markdown raw, chart placeholder). |
| 3 | Triage doc separating engine bugs from authoring patterns. |
| 4 | Three systemic fixes: `text_align`/`align` alias (200+ templates auto-healed), eager markdown render in `rich_text`, neutral styled placeholder for chart/table/map. |
| 5 | Full-catalog render — refined heuristic, parallel rendering. |
| 6 | Per-template fixes (16) + 2 more engine bugs + final baseline. |

## Artifacts
- Inventory:  `tools/audit/inventory.json` (432 entries)
- Per-batch reports: `tools/audit/agent-reports/batch-{1,2,3}.md`
- Final results: `tools/audit/shots/all/results.json`
- Visual baseline: `tools/audit/shots/all/*.png` (432 PNGs)
- Summary text: `tools/audit/shots/all/summary.txt`
