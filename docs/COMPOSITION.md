# Continuous Composition — design proposal

Status: **proposal, not built.** Agreed direction for the next video workstream:
engine + MCP first, editor after. Builds on [MOTION.md](MOTION.md) (keyframe engine
v2, presets, ops, multi-scene export).

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

## 2. Have vs missing

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

## 3. Protocol — state-based storyboard

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
      card1: { in: rise }                    # enters with a preset mechanic
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

## 4. Order

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
