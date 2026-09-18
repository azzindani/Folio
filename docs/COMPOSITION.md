# Continuous Composition

Status: **built 2026-09-18** — all six steps in the engine and the MCP surface, then
the editor side and the open items (§6). Builds on [MOTION.md](MOTION.md) (keyframe engine
v2, presets, ops, multi-scene export); MOTION.md §3 "Continuous composition" is the
reference for how each piece works.

---

## 1. Why

Today a Folio video is a **deck played as scenes**: each page is a scene with its own
timeline, and pages hand over through a page transition (`scenes:true`). That scaffolds
video well, but it is not how professional motion graphics is built.

A 30 s explainer, product promo or kinetic-type piece is **one continuous composition**:

* The **objects carry the story.** A headline shrinks into a corner label, a circle grows
  into the next section's background, a card slides aside to make room — no page wipe.
* It is **not one flat timeline.** Pros build a master comp from nested **precomps** —
  sub-sequences with their own clock that can be reused, retimed or looped.
* **Cuts still happen**, but as match cuts and object handoffs, not slide transitions.

Target: **one continuous world, structured time** — not 200 tracks on one flat clock.

## 2. Positioning — declarative, 2D, built for the loop

HTML/CSS video frameworks are strong but **hard for a model to iterate on in a loop**:

* The model writes a **program**; each pass rewrites code instead of patching values.
* **Positions emerge from CSS layout**, so the model cannot predict where things land.
* The only feedback is **render → look** — slow, needs vision, and not always repeatable.

Folio's shape is the advantage, not a gap:

| Folio has | Why it matters in a create → check → fix loop |
|---|---|
| Declarative YAML | small patches, not rewrites |
| Feedback as numbers — `op:frame` poses, `op:timeline` Gantt | a model without vision still iterates |
| One renderer for editor, SVG and raster frames | repeatable: what was checked is what ships |
| Rescue passes (`engine-finalize-*`) | blind mistakes are fixed before they render |
| One canvas for poster, deck, dashboard, diagram, report | video is **time on top** of every 2D format already built |

### Leverage points

1. **Any design is shot 1.** A finished poster, carousel page or dashboard becomes the
   first state of `op:storyboard`; the model writes only what changes.
2. **Data-driven motion.** Charts and report datasets animate from their own values —
   bars grow to the value, counters land on the figure, lines draw. Hard for AI in HTML
   tools, natural here.
3. **Diagrams build in the right order.** Build order is computed from the graph's
   edges (dependency order) — engine math, not a guess by the model.
4. **Batch.** One template × N content variations → N videos (use case 5).
5. **Time-aware lint is the moat.** Overlap, idle-gap and reading-time checks let the
   model improve a piece over several passes without watching it.

### Scope: 2D only, by design

Folio has been 2D since day 1 and stays 2D. The 2D tools — layers, keyframes, camera,
morph, mattes, text animator — already cover motion graphics; 3D would add a scene
graph, lighting and projection the model would have to reason about, for little gain in
this kind of work. Depth is **suggested in 2D** where a piece needs it: `skew`,
`scale_x` flips, parallax (layers moving at different speeds under one camera move),
blur for depth of field.

The trade-off is accepted: no particles, true 3D or shaders from open code. When an
effect earns a place, it arrives as a **declarative primitive the engine computes**,
never as an escape hatch into raw code — the payload stays simple enough to iterate on.

## 3. Have vs missing

Checked against the source (2026-09-18): no in/out points, markers, parenting or local
clocks exist anywhere in `src/animation`, `src/schema` or the motion ops.

| Have ✓ | Missing ✗ |
|---|---|
| 18 channels, 30+ easings, holds, anchors, `op:camera`, `op:morph`, `clip:true` mattes, `op:text`, motion paths, `op:wiggle` | **Layer in/out points** — a layer exists only in its window; today every layer lives the whole scene (and is rendered every frame) |
| One track per layer; `motion-merge.ts` folds non-overlapping one-shots (enter → hold → exit) | **Many rest states per layer** — presets are rest-relative (`origin: offset`, 0 = the authored spot), so a layer cannot sit at A for 4 s then settle at B except by hand-written `op:track` offsets. Loop + one-shot on one layer and overlapping moves are refused (no additive layering) |
| A group's pose moves its children | **Precomp** — a group with a local clock: `start`, `speed`, `loop`, reuse |
| — | **Parenting / links** — follow another layer's channel with lag + factor → follow-through and overlapping action (secondary motion) |
| `op:sequence` timing: absolute `at` or after the previous step | **Markers** — named time points; steps anchor relatively (`at: "hero.in+200"`) |
| `op:camera` frames a target on the canvas | **World larger than the frame** — the camera travels across a layout bigger than the canvas; replaces page transitions |

## 4. Protocol — state-based storyboard

Follows CLAUDE.md §0.4: the **model designs**, the **engine does the math**.

```yaml
# animation(op:storyboard) — "beats" is taken by the music op, so: shots
shots:
  - id: hook
    at: 0
    states:
      title: { x: 540, y: 400, scale: 1 }
      logo: hidden
  - id: problem
    at: 4000
    states:
      title: { x: 120, y: 90, scale: 0.4 }   # same object, new rest state
      card1: rise                            # enters with a preset ({enter: rise} + a state works too)
```

* The model writes **where each object is in each shot**. The engine diffs consecutive
  states → keyframes (Magic Move), including stagger and handoff timing.
* Output is **ordinary tracks** — every one stays hand-editable. No preset look, no
  template stamping.
* **Time-aware lint** (today's checks look at one frame; these look across `t`):
  * layers overlapping each other at time `t`
  * off-canvas at rest (outside the camera's view, once the world is larger)
  * idle gaps — nothing moving for >2 s
  * attention budget — too many things moving at once
  * reading time per shot (the 240 wpm rule, per shot instead of per page)

## 5. Order

| # | Step | Gives |
|---|---|---|
| 1 | **Time model** — layer `in`/`out`, markers, relative anchors | layers with a lifespan; timing by name |
| 2 | **Many rest states per layer** | a layer moves A → B → C and stays |
| 3 | **`op:storyboard`** (states → tracks) + time-aware lint | the model authors shots, the engine keyframes and checks them |
| 4 | **Precomps** (local clock), then **parenting / links** | reusable sub-sequences; secondary motion |
| 5 | **World camera** across a larger-than-canvas layout | continuous travel replaces page transitions |
| 6 | **Render cost** — skip layers outside their in/out per frame | 200 layers × 900 frames stays fast |

Every step lands on both players in the same commit (CSS route + flipbook), as the
Phase 2 ops did. The editor (timeline bars for in/out, shot strip) follows once the
engine and MCP surface are live.

## 6. Built

| # | Step | Ops | Where |
|---|---|---|---|
| 1 | Time model | `markers`, `span`; every time takes `"marker±ms"` or `"layer.in"` / `.out` / `.start` / `.end` | `motion-time.ts`, `motion-time-ops.ts`, `src/animation/lifespan.ts` |
| 2 | Many rest states | (inside `storyboard`) | `motion-states.ts` |
| 3 | Storyboard + time-aware lint | `storyboard`, `lint` | `motion-storyboard-parse.ts`, `motion-storyboard-op.ts`, `motion-lint.ts` |
| 4 | Precomps, links | `precomp`, `link` | `motion-precomp-op.ts`, `src/animation/timeline-resolve.ts` |
| 5 | World camera | `camera` `world` + region / `"world"` targets | `motion-camera-op.ts`, `motion-camera.ts` (pivot) |
| 6 | Render cost | — | `frame-cull.ts` (hidden, faded, off-canvas left out of raster frames) |

**One resolved tree.** Clocks, links and windows are intent on the layers; `resolveTimeline()`
flattens them onto the scene clock once per page, and the flipbook, the SVG export,
the durations and `op:timeline` all read that result — so the two players cannot disagree.

**Authoring order** (learned live): world first with `op:camera world` and no shots →
the whole scene in ONE `add_layers` call inside a `locked:true` group (layers of a
continuous scene overlap on purpose; the layout rescue would push them apart) →
`op:storyboard` → `op:precomp` / `op:link` → `op:camera` shots → `op:lint`.

**Editor + the rest (same day).** The canvas plays and scrubs the export's own frame
(`motion-pose.ts`: `layersAt()` over the resolved tree — windows hide layers, clocks,
links, paths, scale all show); the timeline draws rows on the scene clock with in/out
bands, motion spans, link ghost keys and a Shots strip from the markers; the editor's
HTML export goes through `buildAnimatedSVG`. A storyboard state can `loop` — how the
layer rests until its next change, unrolled into its one track. `motion_path` takes a
`delay`, follows precomp clocks and travels on its own easing in both players.

**Closed out.** The timeline edits time too — drag a layer's in/out edges, drag / add /
rename / remove markers, snapping to markers, the playhead and the ends — and a looping
precomp repeats a one-shot `motion_path` every pass in both players. The workstream has
no open items.
