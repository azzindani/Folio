# Motion + Image Processing

Folio is no longer a paged-design engine only. Two subsystems make it a
motion and image tool an LLM can drive blind:

| Subsystem | Where | What it gives the model |
|---|---|---|
| **Keyframe engine v2** | `src/animation/` | Per-segment easing (30+ curves incl. bounce/elastic/back, `cubic-bezier`, `steps`), holds, non-uniform scale, skew, blur, stroke reveal (`draw`), anchor points, finite iterations. One track per layer, played identically by CSS (SVG/HTML export) and by the flipbook sampler (GIF/frame). |
| **Motion presets** | `src/mcp/engine/motion-presets.ts` | 28 mechanics — 13 entrances, 6 exits, 9 loops — that expand to ordinary keyframes. Never a look; always rewritable by hand. |
| **Scene authoring ops** | `src/mcp/engine/motion-sequence.ts`, `motion-merge.ts`, `motion-frame.ts`, `timeline-ascii.ts` | `animation(op:sequence)` builds an enter–hold–exit story in one call; `op:track` writes raw keyframes; `op:frame` renders the pose at time *t*; `op:timeline` is a Gantt; `op:clear`; `op:presets`. |
| **Pixel pipeline** | `src/utils/image-{adjust,geometry,filters}.ts`, `src/mcp/engine/asset-process.ts` | Photoshop's Adjustments + Image + Filter menus as pure TS over the PNG codec: brightness/contrast/exposure/gamma/levels, saturation/hue/invert/sepia/duotone/tint/posterize/threshold, crop (box or aspect)/trim/rotate/flip/resize, blur/sharpen/vignette/grain, rounded corners/pad/flatten, background removal. |
| **`manage_design(op:asset_process)`** | `src/mcp/engine/asset-process-op.ts` | Runs a recipe on a stored asset, non-destructively, into a new asset with a ready-to-place layer stub. |

The guide section for models: `get_engine_guide({section:"motion"})`.

---

## 1. The animation model

```yaml
layers:
  - id: title
    type: text
    animation:
      keyframes:
        - { t: 0,    opacity: 0, y: 30, blur: 12, easing: ease-out-expo }
        - { t: 600,  opacity: 1, y: 0,  blur: 0,  hold: true }
        - { t: 3000, opacity: 1 }
        - { t: 3400, opacity: 0, y: -20 }
      playback:
        duration: 3400        # ms, from the first frame
        delay: 0              # ms, when the track starts in the scene
        origin: offset        # x/y are deltas from where the renderer drew the layer
        anchor: center        # pivot for rotate / scale / skew
        # loop: true · iterations: 3 · direction: alternate · easing: <track default>
```

* **One track per layer.** `t` is ms from the track's first frame; `playback.delay` places the track in the scene.
* **Channels:** `x y opacity scale scale_x scale_y rotation skew_x skew_y blur draw draw_start reveal tracking count fill.color stroke.color`.
* **`count`** 0→1 is the fraction of the number written in a text layer that shows (`src/animation/count.ts`): 0 counts from zero, 1 is the text as authored, and the format is kept — prefix, suffix, decimals, thousands separators ("Save 40% today" counts only the 40). The flipbook writes the figure into each frame. The SVG route cannot change what a `<text>` says, so `src/export/count-expand.ts` turns the layer into a group of stepped variants — one per distinct figure, sampled at 30 fps with the flipbook's own `interpolateKeyframes`, capped at 120, each cut in with held keyframes — and keeps the layer's other channels on the group. The editor's live preview shows the static figure.
* **`tracking`** is px added to a text layer's letter-spacing (After Effects' Tracking; 0 = as authored). It never re-wraps: the flipbook writes it as `tracking_offset`, which the renderer adds to the `letter-spacing` attribute while wrapping reads `style.letter_spacing` alone; CSS animates `letter-spacing` on the layer's `<g>` from the authored base (callers pass their layers so `generateDesignAnimationCSS` knows it) with `[data-layer-id] text { letter-spacing: inherit }` — without that rule Chromium kept the `<text>`'s own attribute and the glyphs never moved.
* **`draw_start`** is the other end of `draw` (After Effects' Trim Paths start): the visible run is `draw_start → draw`, so trailing it behind `draw` makes a segment travel along a path. CSS writes a dash pair per step against `pathLength 1`; the flipbook writes the same pair against the measured length.
* **`reveal`** 0→1 wipes a layer into view from `playback.reveal_from` (`left right top bottom center`; center is an iris). One helper (`src/animation/reveal.ts`) gives both players the same numbers: CSS `clip-path: inset(…) fill-box` and a flipbook `clip_rect` over the drawn box. `fill-box` is named because an SVG element's default reference box is the stroke box — Chromium put the edge 5px off the flipbook on a 20px stroke. The wiping edge overshoots the box by 16px at each end, so an outside stroke is hidden at 0 and whole at rest; sides that are not wiping never clip.
  A channel a later frame omits carries its last value forward (no snap-back).
* **`easing` on a keyframe** shapes the segment *leaving* it (After Effects semantics). `hold: true` freezes until the next frame.
* **`draw`** 0→1 reveals a stroke along its own length. The SVG export sets `pathLength="1"` on the shapes in that layer so `stroke-dashoffset` means "fraction of the outline".
* **`origin: offset`** (what every preset and `op:track` write) means `0` = at rest, so entrances start displaced and land exactly where the layer sits. `origin: first` treats the first frame as rest and later frames as deltas from it.
* `spec.animations` (top-level map keyed by layer id) is a mirror the editor reads; the MCP ops keep it in sync.

### Easing vocabulary (`src/animation/easing.ts`)

| Family | Names |
|---|---|
| CSS | `linear ease ease-in ease-out ease-in-out` |
| Penner | `ease-{in,out,in-out}-{quad,cubic,quart,expo,circ,back,elastic,bounce}` |
| Aliases | `snap` (=out-expo) `smooth` (=in-out-cubic) `pop` (=out-back) `spring` (=out-elastic) `bounce` (=out-bounce) `hold` |
| Functional | `cubic-bezier(x1,y1,x2,y2)` · `steps(n[, start\|end])` |

`easingToCSS()` returns a bezier where one exists; curves CSS cannot express (elastic, bounce) are **baked** into 16 linear sub-steps by `keyframe-css.ts`, so the SVG plays the same shape the flipbook samples.

### Two players, one truth

| Route | Consumer | Plays |
|---|---|---|
| `animation(op:export, type:svg\|html)` | `keyframe-css.ts` → `@keyframes` inlined into the render | every channel |
| `animation(op:export, type:gif\|mp4\|webm)` and `op:frame` | `gif-frames.ts` samples `interpolateKeyframes()` per frame, resvg rasterises, frames stream to `gif-stream.ts` or ffmpeg (`video-encode.ts`) | every channel — `draw` is measured on path, line, rect, ellipse and polygon |

`poseAt()` in `keyframe-css.ts` is the reference sampler tests use to check the two agree.

---

## 2. Presets

| Kind | Presets |
|---|---|
| Entrances | `fade_in rise settle scale_in sweep_in pop drop blur_in draw_on spin_in flip_in grow_up whip wipe_in track_in` |
| Exits | `fade_out sink shrink_out blur_out sweep_out pop_out wipe_out` |
| Loops | `pulse float spin drift breathe wobble sway heartbeat flicker` |

`grow_up` and `sway` pivot on the bottom edge (`anchor: bottom`); `drop` uses `ease-out-bounce`, `pop` uses `ease-out-back`, `flicker` is built from held keyframes. `animation(op:presets)` returns all of them with one-line notes plus the easing list, channels and anchors.

---

## 3. The ops

```
animation(op:presets)                                   the menu — no design needed
animation(op:sequence, design_path, steps:[…])          a scene in one call
animation(op:track,    design_path, layer_id|layer_ids, keyframes, playback?, stagger_ms?)
animation(op:motion,   design_path, preset, …)          one preset (= one-step sequence)
animation(op:keyframe, design_path, layer_id, keyframe) one frame
animation(op:frame,    design_path, t, page_id?, scale?, output_path?)   PNG + resolved poses at t
animation(op:timeline, design_path, page_id?)           Gantt: tracks, start/end, channels, scene_ms
animation(op:clear,    design_path, layer_ids?)         remove motion
animation(op:export,   design_path, type:svg|html|gif|mp4|webm, all_pages?, scenes?, hold_ms?)
animation(op:scene,    design_path, page_id, transition?, length_ms?)   how a page enters + its time on screen
animation(op:text,     design_path, layer_id, by?, preset|keyframes, stagger_ms?, order?, mask?)   text animator: split + stagger in one call
animation(op:wiggle,   design_path, layer_id|layer_ids, amplitude{x,y,rotation,scale}, frequency?, duration?, seed?)   seeded noise on a wrapper parent
animation(op:camera,   design_path, shots:[{t, target:"all"|id|ids, padding?, easing?, hold?}], exclude?, padding?)   2D camera: each shot frames its target
```

### `op:sequence`

```json
{ "op": "sequence", "design_path": "…/launch.design.yaml", "steps": [
  { "preset": "blur_in",  "layer_ids": ["title"] },
  { "preset": "rise",     "layer_ids": ["p1", "p2", "p3"], "stagger_ms": 90 },
  { "preset": "draw_on",  "layer_ids": ["underline"], "duration": 900 },
  { "preset": "pulse",    "layer_ids": ["cta"] },
  { "preset": "fade_out", "at": 5000 }
] }
```

* A step without `at` starts when the previous one-shot ends; `at` overlaps or schedules.
* Omit `layer_ids` to target the whole page (a **locked group counts as one unit**).
* Entrances, holds and exits on the same layer **fold into one track** (`motion-merge.ts`): times re-based on the earliest frame, each preset's easing moved onto its own keyframes, the rest-to-rest hop between them linear. Overlaps and loop-on-one-shot are refused with a hint (a loop needs its own layer, or `op:clear` first).
* Returns `steps[{from,to,layers}]` and `scene_ms`.
* `order` on a step (and on `op:motion` / `op:track`) picks which layer the stagger starts from: `forward reverse center edges random left_to_right right_to_left top_to_bottom bottom_to_top`. `src/mcp/engine/motion-order.ts` returns a RANK per layer instead of reordering them, so the delay is `stagger_ms × rank`: mirrored pairs from the centre start together, a column at one x sweeps in as one, and `random` is seeded by the ids — the same every call, never `Math.random`. The position orders use the drawn box, so split_text letters sweep by where they actually sit.

### `op:frame`

Samples every track at `t` through the same code path the GIF uses, renders the still via resvg, and returns it as an image attachment plus `poses[{id,x,y,width,height,opacity,rotation,offset,scale,skew,transform}]` — so a vision model sees the pose and a blind one reads the numbers. `offset` is the only position a line or a path reports (neither has x/y); `x`/`y` are the authored box plus that offset.

**How a sampled frame poses a layer** (`src/export/frame-pose.ts`): offset, rotate, skew and scale become ONE SVG `transform` — translate by the offset, then rotate/skew/scale about the anchor of what the layer DRAWS (`frame-geometry.ts`: a headline's words, a line's end points, a path's `d`), the same box CSS pivots on with `transform-box: fill-box`. A group's pose sits on its own `<g>`, so every child follows — text glyphs scale, lines and paths travel. Editing x/y/width/height instead (the old route) moved nothing without x/y and scaled no text, so `rise` on a connector and `pop` on a headline did nothing in a GIF.

### Multi-scene pieces

A deck's pages play one after another as ONE gif/mp4/webm with `scenes:true` — each page a scene with its own timeline.

| Piece | Where | Rule |
|---|---|---|
| Timing | `src/export/scene-plan.ts` | A scene lasts its motion + `hold_ms` (default 1500), or exactly `page.auto_advance` (`op:scene length_ms`). Scenes run end to end; a page's `transition` plays as it ENTERS, overlapping the start of its own scene, while the outgoing scene rests on its final pose. |
| Transitions | `src/export/scene-transition.ts` | Each `PageTransitionType` is a pose for each scene's full-canvas group — transform, opacity or `clip_rect` — so a frame renders once, as vectors. cube-left/right play as slides, flip-h/v as a squash through the centre, dissolve as a fade; the export reply names them. |
| Frames | `src/export/scene-compose.ts` | The piece at time t as a single page. Transitions that uncover canvas (zoom-out, flip) paint the outgoing page's own ground underneath. |
| Clipping | `src/renderer/clip-rect.ts` | `clip_rect` on any layer and `clip: true` on a group (a track matte) — one `<clipPath>` for the editor, the SVG export and every raster. |

The engine does not decide pacing. It counts words per scene and warns when a scene is on screen for less than they take to read at 240 wpm.
`op:timeline` and `op:frame` take `scenes:true` too, so a transition can be checked without exporting.

---

## 4. Image processing

Recipe object (`ProcessSpec`), applied in this order:

```
crop → remove_bg → trim → rotate/flip → fit → adjust → blur/sharpen/vignette/grain → round → pad → flatten
```

| Key | Shape | Photoshop equivalent |
|---|---|---|
| `crop` | `{x,y,w,h}` or `{aspect:"1:1"\|"16:9"\|…, anchor}` | Crop tool |
| `trim` | `true` or margin px | Image → Trim |
| `rotate` / `flip` | `90\|180\|270` / `"h"\|"v"\|"hv"` | Image Rotation |
| `fit` | `{w,h,mode:"cover"\|"contain"}` | Image Size (bilinear) |
| `remove_bg` | `true` or `{tolerance,feather}` | Magic Wand + delete |
| `adjust` | `{brightness, contrast, exposure, gamma, levels:{black,white}, saturation, hue, invert, sepia, duotone:{shadow,highlight}, tint:{color,strength}, posterize, threshold, opacity}` | Adjustments menu |
| `blur` / `sharpen` | px / `0..5` or `{amount,radius}` | Gaussian Blur / Unsharp Mask |
| `vignette` / `grain` | `0..1` or `{strength,softness,color}` / `0..1` | Lens Correction / Add Noise |
| `round` / `pad` / `flatten` | px / px or `{top,right,bottom,left,color}` / `"#hex"` | Mask / Canvas Size / Flatten |

Reachable two ways:

* `manage_design(op:asset_add, …, process:{…})` — on the way in.
* `manage_design(op:asset_process, project_path, asset_path, process:{…}, name?, folder?, scope?)` — on a stored asset, writing `<stem>-edit.png` (uniquified) next to it, source untouched, `alt` recording the recipe.

PNG only (pure-TS codec; no sharp/canvas in the `bun --smol` container). Non-PNG input errors rather than pretending.

---

## 5. What is still open (for the next session)

* ~~**Long raster motion**~~ — DONE. The GIF route held every frame in memory under a 180 MB budget, so a 30s scene at 1080×1350 shipped at 1fps. `gif-stream.ts` now writes each frame as it renders, merges identical frames and stores only the changed rectangle of an opaque frame; `gif-quantize.ts` cuts over a colour histogram (555ms → ~40ms per frame). `video-encode.ts` pipes the same frames into ffmpeg for mp4 (H.264, yuv420p, faststart) and webm (VP9) — no Puppeteer. `draw` on a `line` now reveals in stills too (only `d` paths were measured). Limits: clips ≤60s, gif ≤50fps, video ≤60fps.

* ~~**Editor timeline panel**~~ — DONE. The scrubber PREVIEWS (applies the pose with recordUndo:false, restores the authored values on stop; it previously moved a thumb and changed nothing). `interpolateAtTime` delegates to `poseAt`, the sampler the CSS route and the flipbook already use, so all three agree and per-keyframe `easing` is honoured. Clicking a keyframe opens an easing picker (`setKeyframeEasing`); a toolbar Stagger offsets each SELECTED layer by one more step than the last (`shiftKeyframes`) — the panel'''s op:sequence. Covered by `tests/commissioning/timeline-panel.spec.ts` in a real browser, which is the only thing that catches a picker whose teardown throws before it writes. NOTE: that suite cannot assert on the .design.yaml — the editor'''s autosave never flushes under the commissioning server, so a file assertion there tests autosave, not the panel.
* ~~**JPEG/WebP decode**~~ — DONE. `src/utils/raster-decode.ts` reads PNG/JPEG/WebP/GIF into RGBA and asset_process always writes PNG. No new dependency: resvg is already here for every raster export and decodes embedded images, so the bytes are wrapped in a one-element SVG at NATIVE size and rendered — one code path, no per-format decoders, and the same library that will rasterise the design later.
* ~~**Flipbook skew/draw**~~ — DONE, via the transform-field route (no browser needed). BaseLayer gained `transform`, `stroke_dasharray` and `stroke_dashoffset`; the renderer applies them, and since the SVG export runs that SAME renderer through JSDOM, the editor and every export agree. The sampler writes skew inside the layer's one pose transform — CSS's own `skew()` matrix about the anchor of the drawn box (see `op:frame` above), since SVG skews about the ORIGIN and a layer skewed in place would otherwise slide across the canvas as it leans — and `draw` as a dash of the path's own length with the offset pulled back, measured by the same flattener the motion sampler uses, so a drawn line and a travelled line agree about where halfway is.
* ~~**Motion paths**~~ — DONE. `animation {op:"motion_path", layer_ids, path}` sets it; `src/animation/motion-path.ts` walks it; `gif-frames.ts` samples it, so `op:"frame"` and the GIF agree with the browser instead of showing the layer parked where it was authored. Progress is by ARC LENGTH (cumulative-length table over a flattened polyline), so the pace stays constant across segments of different lengths. Elliptical arcs (`A`) are REFUSED, not approximated — the browser draws the real arc and an approximation would disagree with it frame for frame. The path OFFSETS the layer from where it sits, so it normally starts `M 0 0`.
* ~~**Illustrator-side**~~ — DONE. `edit_layer {op:"shape", shape_op:"offset"|"outline_stroke"|"blend"}`, built on `src/engine/path-ops.ts` (pure, server-side — the editor's boolean ops sample paths through a live SVG element and only run in a browser). Offset is the union of a quad per segment plus a disc per joint, which is robust on concave shapes where per-vertex normal offsetting self-intersects. Blend resamples both outlines by ARC LENGTH and rotates the second to its closest correspondence, or the in-betweens twist. Coordinates snap to a 0.01px grid because polygon-clipping aborts on near-duplicate points, and unions run piece-by-piece so one awkward shape cannot take out the whole call. Every result is an ordinary `path` layer.
* ~~**Text animation**~~ — DONE. `edit_layer {op:"split_text", by:"char"|"word"}` turns one text layer into one layer per piece, each placed at its MEASURED advance; `animation {op:"sequence", stagger_ms}` then reveals them and the flipbook samples them like anything else. Placement reads real advance widths from the bundled TTFs (`src/utils/font-metrics.ts` — head/hhea/hmtx/cmap): the layout heuristic used elsewhere gives every glyph one average width, and in Plus Jakarta Sans "iii" is 68.7px where "WWW" is 295.2px, so an averaged split would drift apart as it revealed. The reply says whether it measured or estimated, because a drifting run and an unbundled font look identical. Single-line layers only.
