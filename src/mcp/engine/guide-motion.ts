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
          fill.color stroke.color
  draw  0→1 reveals a stroke along its length (lines, connectors, hand-drawn marks).
  blur  px, 16→0 is the cinematic blur-in.
  anchor (playback) is the pivot: center | top | bottom | left | right | corners.
  Per-keyframe: easing (curve LEAVING that frame), hold:true (freeze, then jump).

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
     animation(op:export, type:"svg") for the file (gif for feeds).

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
  • GIF cannot show skew or draw (no still-frame equivalent); SVG/HTML play everything.
`;
