// Procedural source (phase 3) — rules a design stores instead of results. Kept
// out of guide.ts, which sits near the 700-line cap.

export const SOURCE_GUIDE = `# Procedural source — store the rule, not the result

Optional. A literal design is always valid; reach for rules when values REPEAT or
RELATE (one margin, one column width, one accent shared by twenty layers). Every
render, export, frame, diagnose and lint sees the resolved values; the editor
still shows plain layers.

## names — the design's own variables
  names: {Margin: 80, Col: "=(W - Margin * 3) / 2", Accent: "#E4572E"}
  pages[i].names: {Accent: "#1B998B"}      ← a page's names win over the design's
A "=…" name reads W and H (the canvas), utils and the names ABOVE it.

## formulas — a property computed from names
  formulas: {x: "=Margin", width: "=Col", fill: "=Accent", "style.color": "=Ink"}
Keys are the property the renderer reads, dot path for nested — on text:
style.font_size, style.color, content.value. JS expression after "=". The literal
value beside it stays as the fallback.
utils: clamp(v,lo,hi) · lerp(a,b,t) · round(v,dp) · percent(v,total) · px(v) ·
rgba(r,g,b,a) · if(cond,a,b) · coerce(v,type).
Formulas reading state / data / pages are REPORT runtime bindings — unchanged.

## gallery — one cell, many rows
A group stores the template ONCE and the rows it repeats over; every consumer
sees ordinary layers, cells <id>_1…, their layers <id>_<n>_<template id>.
  {id:"people", type:"group", x:80, y:400, width:920, height:600, layers:[],
   gallery:{items:[{name:"Ada", role:"Compilers"}, …] | 6 | "=People",
            template:[ layers placed RELATIVE to the cell's top-left ],
            columns:3, gap:24 | [col,row], cell:{width,height}}}
Cells share the group's box (default: one row on a wide box, one column on a
tall one); cell sets their size instead. Template strings take {{key}} from the
row ({{i}} = 1, 2…); template formulas also read Item (the row), Index (from 0),
Row, Col, N, CellW, CellH: {width:"=CellW", "animation.playback.delay":"=Index*120"}.
Add it with add_layers (verbose layers); change a row, the template or columns
with patch_design on layers[id=people].gallery.
ONE item: edit it by its id (people_4_role) with edit_layer update/move/remove
or patch_design layers[id=people_4_role].… — kept as gallery.overrides (template
frame, replayed on every render; null = item removed). An editor drag does the same.

## animation.rule — motion stored as what it is
  animation: {rule: {preset:"rise", at:1200, duration:600, easing:"ease-out"}}
  animation: {rule: [{preset:"rise", at:0}, {preset:"fade_out", at:"=Beat*8"}]}
Compiled into the same keyframes op:sequence writes; exports, op:frame,
op:timeline and the editor play the track. A list = entrance then exit (must not
overlap); a loop stands alone. at/duration/distance may be "=…" (names; Index in
a gallery template → "=Index*120" staggers the cells). at may be a marker —
at:"cta" or "cta+300" — and then follows it: animation {op:"markers"} moves
every rule on that beat. Write them with
animation {op:"sequence", as_rule:true, steps:[…]} (a step's marker at is kept) or patch_design on
layers[id=…].animation.rule. A rule that cannot compile → diagnose rule_error.

## Writing them
  patch_design {path:"names", value:{…}}
  patch_design {path:"layers[id=card].formulas", value:{width:"=Col"}}
  (a page: pages[id=p2].names / pages[id=p2].layers[id=card].formulas)
Change the name once → every layer reading it follows.

## script — a component on Folio's clock (doodles, stick figures, generative art)
  {id:"doodle", type:"script", x, y, width, height, duration:8000, loop:true, seed:7,
   html:"<canvas id=c></canvas>", css:"…",
   js:"const c=document.getElementById('c'), g=c.getContext('2d');
       c.width=folio.width; c.height=folio.height;
       folio.frame(t => { g.clearRect(0,0,c.width,c.height); /* draw the moment t */ });"}
Draw the MOMENT t (ms), carrying no state between frames — the editor, the HTML
export and every video frame then agree. folio.random() restarts each frame
(stable jitter); folio.hash(n) is per-item noise (boil a hand-drawn line with
folio.hash(Math.floor(t/120)*97+i)); folio.width/height/duration. duration makes
the scene at least that long. No network (inline everything), no new Date(), no
setTimeout — diagnose script_unsafe names them.

## Detach — when you want to hand-edit the result
edit_layer {op:"detach", layer_id} bakes that layer's formulas into values, its
gallery into literal cells <id>_<n>, its animation.rule into keyframes — drawn
exactly as before, then editable one by one. No layer_id = every rule on the
page (page_id) or in the design. In the editor: right-click → Detach rule.

## When one fails
It is NOT applied — the property keeps its literal value — and diagnose_design
reports formula_error naming the layer, the property and the reason.
`;
