# Expectation 01 — Design Quality

> The output bar. Reference set: the 20 curated PNGs in `examples/`
> (commit f22c659) — that level IS the expectation, per design, per run,
> without cherry-picking.

---

## 1. The quality definition

A Folio output passes when a design-literate human would say "someone made
this in Canva/Figma on a good day" — not "an AI generated this."

Concrete, checkable properties:

| Property | Pass criteria |
|---|---|
| Hierarchy | ONE dominant element; headline 4–5× body; clear reading order in ≤3 fixations |
| Composition | Deliberate asymmetry or deliberate symmetry — never accidental centering; whitespace is used, not feared; margins consistent |
| Color | One palette, 1 accent used 1–2×; backgrounds flat or deliberately textured; contrast ≥ WCAG AA for body text |
| Typography | Paired fonts (display + text); ALL-CAPS always tracked ≥0.06em; no orphan words in headlines; line-height tuned per size |
| Density | Page FILLED — no dead bands, no 40% empty tail; but not cramped (breathing room around the dominant element) |
| Craft details | radius 0 or 999 (not the templated 8–16 middle); rules/hairlines for depth, not glows; consistent icon style |
| Content | Real copy, no lorem/placeholder/EMPTY; no invented metrics; no emoji-as-icon |

## 2. Anti-AI-look (zero tells)

The `ai-slop-lint` rules define the tells; expectation = **zero occurrences
in sealed output**:

```
✗ default indigo/violet Tailwind accent          ✗ two-stop purple/blue gradient
✗ emoji used as icons                            ✗ filler/lorem copy
✗ invented metrics (10×, 99.9%, "trusted by…")   ✗ ALL-CAPS without tracking
✗ accent color sprayed >2× per surface           ✗ glow-everything depth
✗ every design centered + card-grid              ✗ same skeleton across prompts
```

## 3. Diversity — the sameness litmus

CLAUDE.md §0.4: *if a change makes outputs more uniform, it's wrong.*

- Two different prompts, same style word ("minimal") → visibly different
  structure (not the same skeleton recolored).
- Same prompt run twice → different but equally strong compositions
  (procedural background grammar + mood lanes + per-style title treatments
  keep variance high).
- Preset monocultures are regressions: versus/timeline/pricing collapsing
  onto `feature_grid`, everything routing to `sections`, editorial-everywhere.
  Measured by `eval_diversity.py`, not by preset-conformance.

## 4. Archetype coverage

Every archetype reachable BOTH by explicit `type:` AND by brief inference
(`enrich_brief` routes market/fair→event, story→editorial, …):

```
editorial · event/flyer · feature_grid · list/steps · stat · sections/infographic
split · pricing · versus · timeline · mindmap · ribbon_cards · value_list
newsletter · decor/backdrop · carousel decks · presentation slides
interactive report (flow) · animated/motion
```

Plus free-hand: a frontier model ignoring every preset must land a custom
layout that survives the finalize passes intact (unified containment, `locked`
honored).

## 5. Styles + moods

- ≥20 named styles / mood lanes; topic seeds mood (content-seeded defaults)
  but an explicit brand hex / color word / theme ALWAYS wins.
- Brand-character themes (atmosphere, type_ladder, section_rhythm) steer type
  and rhythm, not just palette.
- Backgrounds: `bg_style` grammar (gradient/curve/dots/mesh/glow/grain/…) +
  procedural sampling → 100+ distinct same-mood backdrops; visible texture,
  never a flat default gradient.

## 6. Spatial correctness (engine's half of the bargain)

The engine guarantees, for any payload that reaches `seal_design`:

```
✓ nothing off-canvas · no unintended overlaps (decollide, containment-aware)
✓ no invisible text (local-backdrop contrast rescue, hue-preserving)
✓ no clipped/overflowing headlines (fitTitleSize, measured heights)
✓ background always present (polarity-derived fill if missing)
✓ deliberate poster ratios honored (4:5 / 9:16 / 1:1 kept; dead band trimmed
  only when ratio is not deliberate)
✓ multi-page: per-page legibility, no cross-page overprint, no null layers
```

These are RESCUE passes — they fix broken payloads, they never restyle valid
free design.

## 7. How quality is measured

1. **examples/ parity** — new engine features must be demonstrated with
   example-level cases (the 101–116 pattern) rendered + vision-reviewed.
2. **Harness scoring** — meet/edit/bad triage on real model runs; only SEALED
   designs count (unsealed drafts are failures, not OKs).
3. **diagnose_design clean** — zero errors at seal; notes read + addressed in
   ≤3 refinement rounds.
4. **Vision review** — final arbiter; render every design, review with a
   vision model (see [07-testing-validation.md](07-testing-validation.md)).
