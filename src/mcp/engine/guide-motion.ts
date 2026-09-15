// Motion authoring guide — get_engine_guide({section:"motion"}).
// Kept out of guide.ts for its 700-line budget.

export const MOTION_GUIDE = `
🎬 MOTION — authoring animation over MCP (the After Effects layer)

The model designs the motion; the engine plays it. Every op writes ordinary
keyframes on ordinary layers: nothing here is a black box, and any preset can
be rewritten by hand with op:track.

MODEL
  layer.animation = { keyframes:[{t, …channels}], playback:{duration, delay, loop, …} }
  ONE track per layer. t is ms from the track's first frame; playback.delay is
  when the track starts in the scene. x/y are OFFSETS from where the layer sits
  (origin:"offset") — 0 means "at rest", so an entrance starts displaced and
  lands exactly where the renderer drew it.

CHANNELS  x y opacity scale scale_x scale_y rotation skew_x skew_y blur draw
          draw_start reveal tracking count morph fill.color stroke.color
  blur  px, 16→0 is the cinematic blur-in.
  anchor (playback) is the pivot: center | top | bottom | left | right | corners.
  Per-keyframe: easing (curve LEAVING that frame), hold:true (freeze, then jump).
  draw  0→1 reveals a stroke along its length (lines, connectors, hand-drawn marks).
  draw_start  0→1 trims where the stroke BEGINS; trail it behind draw and a
        segment travels along the path (a signal on a wire, a comet on an orbit).
  reveal  0→1 wipes the layer into view; playback.reveal_from = left | right | top |
        bottom | center (an iris). Type, a photo, a chart bar — no mask layer needed.
  tracking  px added to a text layer's letter-spacing (0 = as authored); 24→0 closes a
        title up. Lines never re-wrap while it plays.
  count  0→1 counts the number written in a text layer up to itself — "1,250+", "$4.2M",
        "98%" keep their format; count_up is the preset. Stats, prices, KPIs.
  order (with stagger_ms) — who starts first: forward | reverse | center | edges | random |
        left_to_right | right_to_left | top_to_bottom | bottom_to_top. After split_text,
        left_to_right sweeps the letters by where they sit; random is the same every call.

TEXT ANIMATOR (one call)
  animation(op:text, layer_id, by:"char"|"word"|"line", preset | keyframes, stagger_ms?, order?, mask?)
  Splits the layer into measured units — a wrapped paragraph along its drawn lines — and
  animates them. mask:true holds a clip still over each unit so it rises from under an edge.
  Each unit is an ordinary text layer with an ordinary track: op:frame, op:timeline, op:track work.

WIGGLE (a parent that never sits still)
  animation(op:wiggle, layer_id, amplitude:{x?, y?, rotation?, scale?}, frequency?=2, duration?=4000, seed?)
  Wraps the layer in <id>_wiggle, a group looping seeded noise — the layer's own motion keeps
  playing underneath. The same wiggle every export; seed re-rolls it. A hand-held feel, a live badge.

CAMERA (push in, pull back, pan)
  animation(op:camera, shots:[{t:0, target:"all"}, {t:1200, target:"stat", padding:80}, {t:3000, target:"all"}])
  Puts the page content under a __camera group and frames each shot's target to fill the canvas.
  The page ground stays still; exclude:[ids] holds other layers still too. Call again to re-frame.

MORPH (one shape becomes another)
  animation(op:morph, layer_id:"blob", to_layer:"star" | to:"<d>", duration?, delay?, easing?)
  Resamples both outlines to the same points and writes a morph 0→1 track (channel: morph,
  target outline in morph_to), merged onto the layer's motion. The target layer is hidden.
  Paths only; elliptical arcs (A) are refused.

EASING — the feel is the curve, not the distance
  ease-out-expo  UI snaps · ease-out-cubic  crisp landing · ease-out-back  pop/overshoot
  ease-out-bounce  dropped object · ease-out-elastic  spring · ease-in-*  exits
  linear  spins, scrolls · steps(n)/hold  mechanical, flicker, typewriter feel
  Aliases: snap smooth pop spring bounce hold. Any cubic-bezier(x1,y1,x2,y2).

WORKFLOW (3 calls)
  1. animation(op:presets)                       → the menu (once per session)
  2. animation(op:sequence, design_path, steps:[ → the scene
       {preset:"blur_in",  layer_ids:["title"]},
       {preset:"rise",     layer_ids:["p1","p2","p3"], stagger_ms:90},
       {preset:"draw_on",  layer_ids:["underline"], duration:900},
       {preset:"pulse",    layer_ids:["cta"]},                  ← loop: own layer
       {preset:"fade_out", at:5000} ])                          ← exit, whole page
  3. animation(op:frame, t:600) to check a pose · op:timeline for the Gantt ·
     animation(op:export, type:"svg") for the file (gif or mp4 for feeds).

RULES OF THUMB
  • Entrances 400–800ms, exits 300–500ms, loops 1.2–6s. Stagger 60–120ms.
  • Hierarchy in TIME mirrors hierarchy in space: headline first, body after,
    decoration last. Nothing important should still be moving after ~1.5s.
  • One loop per composition, on the thing that matters (a CTA, a mark). Two
    loops fight. A pulse >1.08 reads as a bug, not emphasis.
  • Steps without \`at\` chain: each starts when the previous ends. Use \`at\` to
    overlap (a title and its rule can enter together) or to schedule an exit.
  • A LOCKED group animates as ONE unit — right for a carousel page, wrong for
    a list you want to stagger: name the children in layer_ids.
  • op:track when a preset is not it: any channels, per-frame easing, holds.
    keyframes:[{t:0,opacity:0,y:30,easing:"ease-out-expo"},{t:500,opacity:1,y:0,hold:true},{t:2500,y:0},{t:2900,opacity:0,y:-20}]
  • Every format plays every channel. gif/mp4/webm stream frame by frame, so a
    30s scene keeps its fps (clips up to 60s; gif ≤50fps, video ≤60fps).
  • Size and smoothness are yours to choose: scale 0.1–1 renders gif/mp4/webm at a
    fraction of the canvas (0.5 → 960×540 from 1920×1080, a quarter of the pixels);
    fps sets smoothness (a GIF at the default 12 looks stepped, 20–25 plays smooth).
    A scaled or re-timed export writes its own file: <name>-960x540-20fps.gif.
  • A raster clip over 150 frames renders in the BACKGROUND: the reply is a job_id,
    not the file. Poll animation(op:export_status, job_id) until state "done" —
    its receipt names the file. Exporting the same file again joins the running job.

MULTI-SCENE PIECES — one video, many pages
  Each PAGE is a scene with its own timeline: author it with page_id on
  sequence / track / motion. Then join the scenes:
    animation(op:scene, page_id:"p2", transition:{type:"slide-left", duration:450}, length_ms?)
                                                  ← how p2 ENTERS, and its exact time on screen
    animation(op:timeline, scenes:true)           → every scene's start and length
    animation(op:frame, scenes:true, t:4200)      → any moment, mid-transition included
    animation(op:export, type:"mp4", scenes:true, hold_ms?)  → ONE file
  • A scene lasts its motion + hold_ms (default 1500) unless length_ms is set.
  • A scene's entrances play DURING its incoming transition: tracks starting at 0
    arrive with the slide; delay them past the transition to land on a settled page.
  • Transitions: fade · slide-left/right/up/down · wipe-left/right · reveal ·
    zoom-in/out · morph · none (a cut). flip-h/v and cube-left/right are flat
    approximations, and the reply says so.
  • The reply warns when a scene is on screen for less time than its words take
    to read at 240 wpm. Whether to cut copy or hold longer is your call.
`;
