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
* **Channels:** `x y opacity scale scale_x scale_y rotation skew_x skew_y blur draw draw_start reveal tracking count morph fill.color stroke.color`.
* **`morph`** 0→1 turns a path layer into its `morph_to` outline (`animation(op:morph)` writes both). `src/engine/path-ops.ts` resamples the two outlines to the same 96 points and rotates the second to its closest start — the Blend machinery — so every frame is a pointwise lerp. The flipbook writes that `d`. The SVG route adds a `-d` `@keyframes` of `d: path()` steps on the `<path>` (a Chromium probe read the exact square→diamond midpoint), and `path[data-layer-id]` runs the pose and the outline in one animation list. Chromium and Firefox play it; Safari shows the start shape. Arcs (`A`) are refused.
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
animation(op:export,   design_path, type:svg|html|gif|mp4|webm, all_pages?, scenes?, hold_ms?, background?, fps?, scale?)
animation(op:export_status, job_id)                     a background render's progress, then its receipt
animation(op:scene,    design_path, page_id, transition?, length_ms?)   how a page enters + its time on screen
animation(op:text,     design_path, layer_id, by?, preset|keyframes, stagger_ms?, order?, mask?)   text animator: split + stagger in one call
animation(op:text,     design_path, remeasure:true, layer_id?, page_id?)   re-place pieces split earlier with today's font widths (text-remeasure.ts)
animation(op:wiggle,   design_path, layer_id|layer_ids, amplitude{x,y,rotation,scale}, frequency?, duration?, seed?)   seeded noise on a wrapper parent
animation(op:camera,   design_path, shots:[{t, target:"all"|id|ids, padding?, easing?, hold?}], exclude?, padding?)   2D camera: each shot frames its target
animation(op:morph,    design_path, layer_id, to | to_layer, keep_target?, duration?, delay?, easing?)   one path becomes another shape
animation(op:audio,    design_path, src?, page_id?, audio_id?, volume?, fade_in?, fade_out?, start_ms?, offset_ms?, duration?, loop?, remove?)   music under the piece, cues on a scene
animation(op:beats,    design_path, audio_id?)          the music's tempo, beats and onsets on the piece, and scene lengths that end on a beat
animation(op:captions, design_path, page_id? + lines? | cues?, style?, clear?, format?)   words on screen, burned into every raster frame; srt/vtt on request
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

**In the editor**, a deck gets **Play all** in the toolbar (Shift+Space). `src/editor/scene-player.ts` plays the piece through `composeSceneFrame` and the same plan, so the stage (`src/ui/scene-stage/`) shows exactly the frame the export renders — two pages mid-transition included — and never writes the design. Its strip draws each scene at its planned length with the incoming transition hatched where it overlaps; the inspector sets a scene's transition, its duration and its time on screen (`state.setPageScene`, undoable), the editor's only transition controls. The stage and the compositor load on first use: in the main entry they broke the 500KB bundle budget. `frame-geometry.ts` finds the bundled fonts through `src/utils/bundled-fonts-dir.ts`, which imports no Node, so the pipeline bundles for the browser (it measures by estimate there); `scene-compose-browser.test.ts` fails on any Node import in that graph.

**Export → MP4 video / GIF animation** in the editor saves the design, then `POST /__project_files/__export` on the editor's static server (`src/editor/server-export.ts`) forwards to `animation(op:export, background:true, scenes:<is a deck>)` on the MCP server beside it — one render queue, and the same file an MCP export writes. The editor follows `GET /__project_files/__export/status` in a progress strip and downloads the file through `/__project_files`.

### Sound

A video's sound lives in the design. `audio:` holds tracks that run under the whole piece (music); a page's `audio_cues:` hold sounds that start with that scene. Sound files are project assets under `assets/audio/` (mp3, wav, m4a, aac, ogg, opus, flac): `manage_design(op:asset_add)` stores the bytes untouched, records `duration_ms` with ffprobe, and refuses a file with no audio stream before it can replace a good one.

| Piece | Where | Rule |
|---|---|---|
| Plan | `src/export/audio-plan.ts` | Pure and browser-safe. A track starts `start_time` ms into the piece, a cue `at` ms after its scene's first frame; `offset` skips into the file, `duration` stops it, `loop` repeats the file. Everything is cut at the piece's end: the scenes set the length, not the music. The plan NOTES what a listener would notice (music cut off with no fade, a track that runs out early, a sound that starts after the end) and decides nothing. `clipGain` = volume under linear fades. |
| Files | `src/mcp/engine/sound-resolve.ts` | Each src is found under the image asset rules (the project, then `lib/…`, nothing outside them) and measured with ffprobe. A missing file is left out, with a note. |
| Mix | `src/export/audio-mux.ts` | One ffmpeg pass AFTER the frames, `-c:v copy`: each clip trimmed, faded, delayed and summed (`amix normalize=0`, so a cue does not duck the music) under a peak limiter, padded to the piece. AAC 192k in mp4, Opus 128k in webm. Not inside the frame pipe: audio encodes in milliseconds while each frame takes ~150 ms, and ffmpeg's muxing queue overflows waiting for video. A failed mix keeps the rendered video and replies with a `warning` that it is silent, which the editor's toast shows. |
| Door | `animation(op:audio)` | `src` adds a sound (replacing the one with its `audio_id`), `audio_id` + fields changes one, `remove:true` takes one or all out, no arguments lists. Every reply is the soundtrack as it will mix, with one ascii lane per clip. |

A GIF has no sound, and its export says so in `notes`.

**Beats** (`animation(op:beats)`) measure the music so cuts can land on it. `src/export/beat-detect.ts` is pure math over mono PCM that ffmpeg decodes at 11 025 Hz (`src/mcp/engine/audio-analyze.ts`, cached by path, size and mtime):

1. Onset strength is log spectral flux per frequency band (0–150–400–1000–2500 Hz–top), with each band getting one vote. Summed over raw bins, a kick drum spanning a handful of bass bins lost to a quiet hi-hat spread over hundreds, and a live 120 BPM test track was tracked on its off-beat ticks, 250 ms late.
2. Tempo is the autocorrelation of that envelope, mean removed, over 60–200 BPM. A broad prior around 120 BPM picks the tempo a listener taps rather than its half or double.
3. Beats are placed by dynamic programming (Ellis 2007).

`confidence` is the correlation at the tempo: noise reads under 0.25, so `pulse` reports steady, weak or none and a track with no pulse gets no grid. The reply puts every beat on the PIECE timeline (offset and loops applied) and gives `scenes_on_beat`: for each scene, the `length_ms` that ends it on its nearest beat, each counting the scenes before it. It writes nothing; the model applies a length with `op:scene`, or keeps a cut where the story wants it.

### Captions

A design's `captions:` holds a `style` and `cues` timed on the piece; a page's `captions:` holds lines timed from its scene's first frame (`at`, `duration`). Lines without times share their scene by word count, and times the model set are kept.

| Piece | Where | Rule |
|---|---|---|
| Plan | `src/export/caption-plan.ts` | Pure. Merges piece cues and scene lines into one ordered list. An overlap is trimmed (the later caption takes the screen) and a caption past the end is cut. Notes flag a caption needing more than ~17 characters a second, one shown under 1s, and one that ends before it starts. |
| Drawing | `src/export/caption-layers.ts` | `withCaptions(frame, plan, style, t)` adds a box and centred text above every layer (z 1 000 000), a margin in from the bottom or top. The box is sized by `plainTextLayout`, the wrap rule the renderer draws with. The export's frames (scenes and single page), `op:frame` and ScenePlayer all call it, so the caption in the file is the caption on the stage. |
| Files | `src/export/caption-files.ts` | SubRip and WebVTT, written only when `op:captions format` asks. |

The svg/html motion export does not carry captions. `op:export captions:false` leaves them out of a raster.

**In the editor**, an audio asset's right-click menu offers **Use as soundtrack** (`state.setAudioTracks`, undoable; a 1s fade-out by default, since a track cut dead at the end sounds broken). Play all sounds the piece through `src/editor/scene-audio.ts`: the clips of `planSound` scheduled on a WebAudio clock with offsets into decoded buffers and gain ramps for the fades, so it needs no HTTP range support and a seek sounds from the right place. Sound follows the transport's edges — play, the pause-and-play a seek makes, pause — and restarts at the current time after an edit, a finished decode or a mute switch. A file that decodes after play starts late at the position the piece has reached. The stage's sound row (`src/ui/scene-stage/scene-stage-sound.ts`) draws each clip under the scene strip on the same scale, with the plan's notes, a mute switch and each track's volume and fades.

---

### Continuous composition

One page, one clock, many sub-sequences — the proposal and its reasoning are [COMPOSITION.md](COMPOSITION.md).

```
animation(op:storyboard, shots:[{id, at, states:{<id>: {x,y|dx,dy, scale, rotation, opacity, blur, fill.color, enter, exit, hidden, duration, delay, easing} | "hidden" | "show" | "<preset>"}, duration?, easing?, stagger_ms?, order?, hold?}], length_ms?, hold_ms?)
animation(op:markers, markers:{name: time | null}, clear?)      named points on the scene clock
animation(op:span, layer_id|layer_ids, in?, out?, clear?)      a layer exists only between them
animation(op:precomp, layer_id, layer_ids?, start?, speed?, loop_ms?, duplicate:{id, start?, dx?, dy?}?, clear?)
animation(op:link, layer_id|layer_ids, to, channels?, lag?, factor?, stagger_ms?, clear?)
animation(op:lint)                                              the time-aware checks, read-only
animation(op:camera, world:{x,y,width,height}|"auto"|"none", shots:[{t, target:…|"world"|{x,y,width,height}}])
```

| Piece | Where | Rule |
|---|---|---|
| Times | `src/mcp/engine/motion-time.ts` | ms, a marker (`hook`), a layer point (`title.in` `title.out` `card.start` `card.end`), each `±ms`. Resolved to ms when an op writes (markers label the timeline, they do not drive it). An exact marker name wins; names are matched lazily, so `cta-200` is `cta` minus 200; marker names may not end in `-digits`. Storyboard, span, sequence `at`, camera `t`, precomp `start` all take them. |
| In/out points | `src/animation/lifespan.ts` | `in` ≤ t < `out` on the scene clock. The flipbook marks a layer outside its window `visible:false` and never samples its children; the SVG plays `visibility` as `step-end` keyframes in the same animation list as the pose (`generateKeyframeCSS(…, extra)`), only when `generateDesignAnimationCSS(…, {lifespans:true})` — the editor canvas replays its CSS on every render and must not hide layers. Windows count toward `animationDuration` / `oneShotDuration`. |
| States | `src/mcp/engine/motion-states.ts` | A list of absolute states → one track (`origin:offset`). `x`/`y` place the top-left of the DRAWN box after its scale (pivot fractions from the anchor); presets compose onto a state (offsets add, ratios multiply). A layer that starts hidden gets an `in` at its first entrance; one that ends hidden gets an `out`. A change that starts before the previous one lands waits for it (and says so). |
| Storyboard | `motion-storyboard-parse.ts`, `motion-storyboard-op.ts` | Shots in time order; the stagger runs over every layer a shot names, in order. The page as authored is the state before shot 1. Compiled twice: once to find where the last move lands, once holding every track to the end (`hold_ms`, default 2500). Shot ids become markers. A second call re-blocks — the storyboard owns the tracks it names (`replaced`). |
| Lint | `src/mcp/engine/motion-lint.ts` | Each shot is read at its REST — its longest stretch with nothing moving (found live: "just before the next shot" caught a camera already panning away). There: text resting on text (>15% of the smaller box); text CUT by the frame edge, or text that just appeared wholly outside it (text a camera left behind is not flagged); reading time for newly shown words (240 wpm) against the rest. Across the piece: idle stretches >2 s that are longer than the shot's reading time + 1 s; >4 separate things moving at once (the same move by siblings is one gesture; link followers do not count); links to missing or still targets. Boxes come from `canvasBoxes` (`frame-cull.ts`) on the sampled frame. |
| Precomp | `src/animation/timeline-resolve.ts` | `clock:{start, speed, loop}` on a group. Inner clocks resolve first; every descendant track, in and out point moves onto the parent clock (`t/speed`, delay `start + delay/speed`). A looping precomp cycles each one-shot child into one period (held at its first pose until its delay, cut at the period). `motion_path` stays on the scene clock; in/out inside a looping precomp apply to its first cycle only (the op says so). |
| Link | `timeline-resolve.ts` | `link:{to, channels, lag, factor}` on a `<id>_link` wrapper. The wrapper plays the target's RESOLVED track `lag` ms later; travel is scaled from rest (0 for offsets and angles, 1 for scale and opacity, the first frame for an `origin:first` x/y). Chains resolve; cycles resolve to nothing. Live: change the target and the follower follows. |
| One resolved tree | `resolveTimeline()` | Clocks → links → windows clipped to their ancestors. The flipbook (`layersAt`), the durations, `op:timeline` and the SVG export (`buildAnimatedSVG`) all read it, cached per page array; a tree without these features comes back as the same array. |
| World | `motion-camera-op.ts`, `motion-camera.ts` | `world` on the page (or poster root); `op:camera` with `world` and no shots declares it BEFORE the layout. The camera group and its pin cover the world, so both players pivot on the world's centre; `framePose(target, canvas, padding, pivot)` puts the target's centre on the canvas centre from any pivot. `snapOffCanvasContent` leaves content inside the world alone, `add_layers` never auto-fits a poster's canvas to content when a world is declared (found live: a 3840 scene group turned the 1920 canvas into 3840), and `append_page replace` keeps `markers` and `world`. |
| Render cost | `src/export/frame-cull.ts` | Raster frames only: layers outside their window, faded to 0, or wholly off the (padded) canvas are left out — unless another layer clips with them. The animated SVG keeps everything. |

The rescue passes know about time too: `decollideHandPlaced` never moves a layer with an in or out point — two headlines on one spot, one leaving as the other lands, is the composition. But `add_layers` runs before any storyboard exists, so the authoring order is: world first (if any), then the whole scene in ONE `add_layers` call inside a `locked:true` group (the rescue leaves a locked group alone; every motion op still reaches its children by id), then storyboard → precomp / link → camera shots. Found live: an unlocked scene had its cards pushed below the title and its right-hand section snapped onto the canvas.

Verified live 2026-09-18 over raw JSON-RPC: a 14.6 s 1920×1080 scene (5 shots, a looping precomp, a link, a camera travelling a 3840 world) — op:frame stills, the SVG's CSS and frames pulled from the MP4 agree.

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

* ~~**Continuous composition**~~ — SCAFFOLDED 2026-09-18 (all six steps, engine + MCP; §3 above). Open: the editor (timeline bars for in/out, a shot strip, the canvas hiding layers outside their window while scrubbing); the editor's own HTML export (`exporter.ts`) still generates CSS from the unresolved tree; loops inside a storyboard need their own layer; `motion_path` ignores precomp clocks.

* ~~**Long raster motion**~~ — DONE. The GIF route held every frame in memory under a 180 MB budget, so a 30s scene at 1080×1350 shipped at 1fps. `gif-stream.ts` now writes each frame as it renders, merges identical frames and stores only the changed rectangle of an opaque frame; `gif-quantize.ts` cuts over a colour histogram (555ms → ~40ms per frame). `video-encode.ts` pipes the same frames into ffmpeg for mp4 (H.264, yuv420p, faststart) and webm (VP9) — no Puppeteer. `draw` on a `line` now reveals in stills too (only `d` paths were measured). Limits: clips ≤60s, gif ≤50fps, video ≤60fps.

* ~~**Editor timeline panel**~~ — DONE. The scrubber PREVIEWS (applies the pose with recordUndo:false, restores the authored values on stop; it previously moved a thumb and changed nothing). `interpolateAtTime` delegates to `poseAt`, the sampler the CSS route and the flipbook already use, so all three agree and per-keyframe `easing` is honoured. Clicking a keyframe opens an easing picker (`setKeyframeEasing`); a toolbar Stagger offsets each SELECTED layer by one more step than the last (`shiftKeyframes`) — the panel'''s op:sequence. Covered by `tests/commissioning/timeline-panel.spec.ts` in a real browser, which is the only thing that catches a picker whose teardown throws before it writes. NOTE: that suite cannot assert on the .design.yaml — the editor'''s autosave never flushes under the commissioning server, so a file assertion there tests autosave, not the panel.
* ~~**JPEG/WebP decode**~~ — DONE. `src/utils/raster-decode.ts` reads PNG/JPEG/WebP/GIF into RGBA and asset_process always writes PNG. No new dependency: resvg is already here for every raster export and decodes embedded images, so the bytes are wrapped in a one-element SVG at NATIVE size and rendered — one code path, no per-format decoders, and the same library that will rasterise the design later.
* ~~**Flipbook skew/draw**~~ — DONE, via the transform-field route (no browser needed). BaseLayer gained `transform`, `stroke_dasharray` and `stroke_dashoffset`; the renderer applies them, and since the SVG export runs that SAME renderer through JSDOM, the editor and every export agree. The sampler writes skew inside the layer's one pose transform — CSS's own `skew()` matrix about the anchor of the drawn box (see `op:frame` above), since SVG skews about the ORIGIN and a layer skewed in place would otherwise slide across the canvas as it leans — and `draw` as a dash of the path's own length with the offset pulled back, measured by the same flattener the motion sampler uses, so a drawn line and a travelled line agree about where halfway is.
* ~~**Motion paths**~~ — DONE. `animation {op:"motion_path", layer_ids, path}` sets it; `src/animation/motion-path.ts` walks it; `gif-frames.ts` samples it, so `op:"frame"` and the GIF agree with the browser instead of showing the layer parked where it was authored. Progress is by ARC LENGTH (cumulative-length table over a flattened polyline), so the pace stays constant across segments of different lengths. Elliptical arcs (`A`) are REFUSED, not approximated — the browser draws the real arc and an approximation would disagree with it frame for frame. The path OFFSETS the layer from where it sits, so it normally starts `M 0 0`.
* ~~**Illustrator-side**~~ — DONE. `edit_layer {op:"shape", shape_op:"offset"|"outline_stroke"|"blend"}`, built on `src/engine/path-ops.ts` (pure, server-side — the editor's boolean ops sample paths through a live SVG element and only run in a browser). Offset is the union of a quad per segment plus a disc per joint, which is robust on concave shapes where per-vertex normal offsetting self-intersects. Blend resamples both outlines by ARC LENGTH and rotates the second to its closest correspondence, or the in-betweens twist. Coordinates snap to a 0.01px grid because polygon-clipping aborts on near-duplicate points, and unions run piece-by-piece so one awkward shape cannot take out the whole call. Every result is an ordinary `path` layer.
* ~~**Text animation**~~ — DONE. `edit_layer {op:"split_text", by:"char"|"word"}` turns one text layer into one layer per piece, each placed at its MEASURED advance; `animation {op:"sequence", stagger_ms}` then reveals them and the flipbook samples them like anything else. Placement reads real advance widths from the bundled TTFs (`src/utils/font-metrics.ts` — head/hhea/hmtx/cmap, from the static file whose OS/2 weight is nearest the layer's `font_weight`): the layout heuristic used elsewhere gives every glyph one average width, and in Plus Jakarta Sans "iii" is 68.7px where "WWW" is 295.2px, so an averaged split would drift apart as it revealed. The reply says whether it measured or estimated, because a drifting run and an unbundled font look identical. Single-line layers only.
