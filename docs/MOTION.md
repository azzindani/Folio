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
* **Channels:** `x y opacity scale scale_x scale_y rotation skew_x skew_y blur draw fill.color stroke.color`.
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
| `animation(op:export, type:gif)` and `op:frame` | `gif-frames.ts` samples `interpolateKeyframes()` per frame and re-renders | all but `skew_*` and `draw` (no still-frame equivalent in the layer schema — they hold at rest) |

`poseAt()` in `keyframe-css.ts` is the reference sampler tests use to check the two agree.

---

## 2. Presets

| Kind | Presets |
|---|---|
| Entrances | `fade_in rise settle scale_in sweep_in pop drop blur_in draw_on spin_in flip_in grow_up whip` |
| Exits | `fade_out sink shrink_out blur_out sweep_out pop_out` |
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
animation(op:export,   design_path, type:svg|html|gif|mp4|webm, all_pages?)
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

### `op:frame`

Samples every track at `t` through the same code path the GIF uses, renders the still via resvg, and returns it as an image attachment plus `poses[{id,x,y,width,height,opacity,rotation}]` — so a vision model sees the pose and a blind one reads the numbers.

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

* **Editor**: the timeline panel (`src/ui/panels/timeline-panel.ts`) still shows diamonds only — no per-frame easing picker, no scrubber preview of skew/blur/draw, no `op:sequence` equivalent. Client changes need a dist rebuild.
* ~~**JPEG/WebP decode**~~ — DONE. `src/utils/raster-decode.ts` reads PNG/JPEG/WebP/GIF into RGBA and asset_process always writes PNG. No new dependency: resvg is already here for every raster export and decodes embedded images, so the bytes are wrapped in a one-element SVG at NATIVE size and rendered — one code path, no per-format decoders, and the same library that will rasterise the design later.
* **Flipbook skew/draw**: materialise via a transform field on the layer schema, or rasterise the SVG route's CSS per frame with a browser.
* ~~**Motion paths**~~ — DONE. `animation {op:"motion_path", layer_ids, path}` sets it; `src/animation/motion-path.ts` walks it; `gif-frames.ts` samples it, so `op:"frame"` and the GIF agree with the browser instead of showing the layer parked where it was authored. Progress is by ARC LENGTH (cumulative-length table over a flattened polyline), so the pace stays constant across segments of different lengths. Elliptical arcs (`A`) are REFUSED, not approximated — the browser draws the real arc and an approximation would disagree with it frame for frame. The path OFFSETS the layer from where it sits, so it normally starts `M 0 0`.
* ~~**Illustrator-side**~~ — DONE. `edit_layer {op:"shape", shape_op:"offset"|"outline_stroke"|"blend"}`, built on `src/engine/path-ops.ts` (pure, server-side — the editor's boolean ops sample paths through a live SVG element and only run in a browser). Offset is the union of a quad per segment plus a disc per joint, which is robust on concave shapes where per-vertex normal offsetting self-intersects. Blend resamples both outlines by ARC LENGTH and rotates the second to its closest correspondence, or the in-betweens twist. Coordinates snap to a 0.01px grid because polygon-clipping aborts on near-duplicate points, and unions run piece-by-piece so one awkward shape cannot take out the whole call. Every result is an ordinary `path` layer.
* **Text animation**: per-character/word reveal needs the text layer split into spans.
