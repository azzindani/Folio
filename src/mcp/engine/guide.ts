// Engine reference guide — split into sections to stay within 1K output budget.
// Default section (quick_ref) ≈200 tokens. Full guide = 4 calls ≈800 tokens total.

const SECTIONS: Record<string, string> = {

  quick_ref: `# Folio Quick Ref
Canvas: 1080x1080 (sq) · 1080x1350 (port) · 1920x1080 (land) · units: px
Design types: poster (single page) | carousel (multi-page)
z = stacking order (higher = front)

⚠️ EVERY sized layer (rect, image, ellipse, icon, group, chart, kpi_card…)
   MUST have a positive width AND height — or use pos:[x,y,w,h]. Without
   dimensions the layer renders INVISIBLY. add_layers now rejects 0-dim
   layers with a clear error, but get it right first to save round-trips.

🎨 DESIGN LIKE A HUMAN — not an AI template. The #1 tell of AI-generated design
   is a dark-navy canvas + blue/purple GRADIENT + one glowing accent + centered
   text. Avoid that. Make it look art-directed:
   • CANVAS: flat solid — NO gradient by default. Warm off-white #FAF5EC / #FFFBEB,
     near-black #0A0A0A, or a deep editorial hue. Gradient only if the topic earns it.
   • TYPE IS THE DESIGN: headline 4–5× the body (e.g. 100 vs 26). Pair fonts per
     layer via \`font\`: display "Playfair Display"/"Bebas Neue"/"Anton" · body
     "Inter"/"Public Sans" · LABELS "IBM Plex Mono"/"JetBrains Mono".
   • Tight headlines: lh:1.0–1.05, track:-1..-2. Mono labels: UPPERCASE, track:1.5.
   • ONE accent color, used 1–2× (a stat, a rule) — never on everything.
   • ASYMMETRY + whitespace: left-anchor at x:80–100, leave a column empty. Don't
     center everything. Depth via a 2–4px RULE/line, NOT glows or soft shadows.
   • radius: 0 (editorial/print) OR 999 (pills) — avoid the 8–16 "templated" middle.

🧭 GOOD DESIGN IS HARD — WORK IN PASSES, don't one-shot the happy path. A flat,
   centered, single-size layout "renders" but reads mediocre. Aim higher:
   1. SYSTEM: pick canvas + a real palette (bg · text · ONE accent · neutrals) +
      a type SCALE (e.g. 88/27/20) + a margin you hold on every side.
   2. HIERARCHY: ONE focal point — the headline 3–5× the body. Everything else
      is clearly secondary. If two things shout, neither does.
   3. STRUCTURE: left-anchor to 1–2 columns; group content into labeled sections
      with consistent vertical rhythm. Align edges to the grid.
   4. DEPTH/DECOR LAST: a thin rule, a single decor/backdrop layer in the margins
      — never gradients/glow competing with the content. Decoration serves the
      hierarchy; if it fights the text, cut it.
   5. SELF-REVIEW → REFINE: after add_layers, READ the returned notes (the engine
      critiques weak hierarchy, accent sprawl, edge-crowding, off-grid edges) AND
      look at the render. Then patch_design to fix the weakest thing. One pass is
      rarely enough — a strong poster is usually 2–3 refinement rounds.

✅ Editorial poster recipe (flat canvas · serif hero ~4:1 · mono label · one accent · asymmetric):
   add_layers(design_path=..., layers_shorthand=[
     {id:"bg",   type:"rect", z:0,  pos:[0,0,1080,1350], fill:"#FAF5EC"},
     {id:"kick", type:"text", z:10, pos:[96,110,820,30], text:"FIELD NOTES — NO. 01",
        size:20, weight:600, color:"#6E5F4A", font:"IBM Plex Mono", track:1.5},
     {id:"rule", type:"rect", z:10, pos:[96,158,820,2], fill:"#2A2218"},
     {id:"tick", type:"rect", z:11, pos:[96,156,140,7], fill:"#B8543C"},
     {id:"head", type:"text", z:10, pos:[96,250,880,470], text:"A headline that does the work.",
        size:108, weight:800, color:"#2A2218", font:"Playfair Display", lh:1.02},
     {id:"body", type:"text", z:10, pos:[96,780,560,230], text:"One clear idea. Left column, right side breathes.",
        size:27, color:"#2A2218", font:"Inter"},
     {id:"stat", type:"text", z:10, pos:[96,1060,640,120], text:"61% → 89%",
        size:92, weight:800, color:"#B8543C", font:"Playfair Display"} ])
   Other moods (same recipe, swap palette+fonts): BOLD POSTER bg #0A0A0A / accent
   #FF3D00 / Anton+Inter · SWISS bg #F0F0F0 / red #D02020 / Space Grotesk · WARM
   bg #FFFBEB / terracotta #9A3412 / Playfair. Pick a palette that fits the topic.

🃏 CARDS / features / benefits? Use the feature_grid PRESET — ONE layer; the engine
   positions title + cards (NEVER hand-place card x/y — they collide into a pile).
   Give a FLAT bg + accent, not "gradient":
   add_layers(design_path=..., layers_shorthand=[
     {type:"feature_grid", pos:[0,0,1080,1080], bg:"#0A0A0A", accent:"#FF3D00", text_color:"#FAFAFA",
       title:"Brew Lab", subtitle:"Freshly roasted beans, delivered monthly",
       items:[
         {icon:"coffee", title:"Single Origin", desc:"Ethically sourced beans"},
         {icon:"truck",  title:"Monthly Box",   desc:"Delivered to your door"},
         {icon:"award",  title:"Guaranteed",    desc:"Love it or full refund"}]}
   ])   ← title auto-wraps & auto-sizes; cards evenly spaced. card_fill/accent/text_color optional.

📋 A NUMBERED LIST? ("5 tips", "3 steps", "7 reasons", "N ways/habits/rules") — the
   most common poster, and the one hand-placing ALWAYS breaks (your headline wraps and
   buries item 1). Use the list PRESET — ONE layer; the engine measures each item and
   stacks them with even rhythm (no overlap, no dead bottom), accent markers in the gutter:
   add_layers(design_path=..., layers_shorthand=[
     {type:"list", pos:[0,0,1080,1350], bg:"#FAF5EC", accent:"#B8543C", text_color:"#1A1A1A",
       kicker:"Engineering — No. 05", title:"5 Habits of Highly Effective Engineers",
       marker:"number", footer:"folio / 2026", items:[
         {title:"Write Small, Focused Tests", desc:"Tests that verify one thing pinpoint failures."},
         {title:"Read Error Messages",        desc:"The stack trace tells you exactly what broke."}, …]}
   ])   ← headline + every item auto-sized & vertically distributed. marker:"number"|"bullet"|"icon"|"none".
        kicker/footer optional. This is the RIGHT tool for any "list of N items" — don't hand-place it.

📊 ONE BIG STAT? ("73% of…", a single headline figure) — use the stat PRESET (aliases
   metric/big_number): {type:"stat", bg, accent, stat:"73%", kicker:"…", caption:"…"}. The
   engine sizes the number to dominate so the focal hierarchy is guaranteed — don't hand-place
   a giant number (it overflows and collides with the caption).

🎟️ EVENT / GIG / LAUNCH FLYER? (big name + date/venue/time) — use the event PRESET (aliases
   flyer/hero): {type:"event", bg, accent, palette:[…], title:"Neon Nights",
   details:["Sat 14 June","Riverside Park","7PM till late"]}. Big auto-sized title + a detail
   stack + margin accent bars, centered to fill the canvas — don't hand-place it (the title
   collides with the details and decor lands invisible).

Follow next_action: every write tool returns next_action:{tool,params} — call
it as your next tool call. create_design/append_page/seal_design/export_design
each also return open_url — a clickable, unique-token editor link (no separate
open_in_editor call needed; use that only to re-open or focus a page).

📁 Paths: pass project_path / path as a short BARE NAME ("ai-poster"). The
   engine places it in the projects dir automatically. NEVER build absolute
   paths like /home/... — you can't know the container layout and a wrong
   guess makes the editor link open empty.

Poster workflow:
  0. create_project(name="ai-poster")                                  → bare name; path optional
  1. create_design(project_path="ai-poster", name, type="poster", …)   → next_action: add_layers
  2. add_layers(design_path, layers_shorthand=[…])                     → next_action: seal_design
  3. seal_design(design_path)                                          → returns open_url
  4. export_design(design_path, format="svg")   (optional)

Carousel workflow:
  1. create_task(project_path, task_name, brief, pages=[{label,hints}])
  2. append_page(design_path, page_id, layers_shorthand=[…], task_path=…)
     → repeat until next_action.remaining==0 (each call returns open_url for the new page)
  3. seal_design(design_path)

Rules:
  - Always use layers_shorthand (verbose works too but is 5× the tokens)
  - Every sized layer needs pos:[x,y,w,h] OR width+height — no exceptions
  - Always pass task_path in append_page — enables auto-handover
  - Call resume_task(task_path) after any context reset
  - 3–8 layers per page is ideal
  - Load guide sections on demand: shorthand | layers | workflow | reference
  - MATCHING a reference image (Canva/screenshot)? Call extract_reference FIRST
    (colors you see + optional data:/path image) → palette + canvas + brief, then
    create_design + add_layers. Load the \`reference\` guide section for the full loop.

🎨 Make it RENDER (avoid blank posters):
  - NO photos: you can't supply image files. A bare src like "coffee.jpg"
    shows a placeholder frame. Build visuals from rect/ellipse/line/icon +
    fills/gradients instead. Only use type:"image" with a real https:// URL.
  - Icons: use a real name (star, heart, check, user, mail, image, arrow-right,
    map-pin, zap, award, calendar, phone, shopping-cart). Unknown names render
    as a labeled placeholder. Synonyms are tolerated (photo→image, gear→settings).
  - Put real copy in every text layer — empty text renders nothing.
  - CONTRAST: text must contrast with the block beneath it. Light text on a light
    canvas — or on a colored chip NARROWER than its label (the text spills past the
    chip onto the canvas) — renders invisible. Always lay a full-canvas bg rect first.
  - 📐 SIZE TEXT BOXES FOR WRAPPING (the #1 thing you're blind to): a box fits about
    floor(width ÷ (0.55 × font_size)) chars per LINE. A 96px headline in an 880px box
    fits ~16 chars/line — so a 40-char title is 3 lines ≈ 3×96 ≈ 290px tall, NOT 120.
    If the height is too short the text spills past the box and lands ON the layers
    below (diagnose reports this as text_overflow). So: estimate the line count, set
    height ≈ lines × font_size × 1.1, and leave that much vertical gap before the next
    layer. When unsure, OVER-size the height. Easiest: use the editorial / feature_grid
    preset — it auto-sizes every block so text never collides.
  - add_layers returns notes:[…] when something won't render as intended (invisible
    text, off-canvas layers, missing background, text_overflow) — read them and fix in
    your next call.
  - VERIFY before sealing: diagnose_design(design_path) lists problems (text_overflow,
    off-canvas, collisions, near-miss MISALIGNMENT, low contrast, weak hierarchy) each
    with a fix; FIX EVERY error then re-run it until zero errors. align_layers fixes
    alignment; render_preview(design_path) returns a PNG so you can SEE the result.
    Fix → re-check → seal.`,

  shorthand: `# Shorthand Syntax (layers_shorthand field)
pos:[x,y,w,h] replaces x/y/width/height.

Rect:   {id:"bg",    type:"rect",  z:0,  pos:[0,0,1080,1080], fill:"#1A1A2E"}
Image:  {id:"hero",  type:"image", z:5,  pos:[0,0,1080,540],  src:"/path/img.jpg"}
Text:   {id:"h1",    type:"text",  z:10, pos:[80,200,920,120], text:"Title", size:72, weight:700, color:"#fff"}
Text:   {id:"sub",   type:"text",  z:11, pos:[80,340,800,60],  text:"Sub",   size:24, color:"#aaa", align:"center"}
Pill:   {id:"pill",  type:"rect",  z:12, pos:[80,460,200,48],  fill:"#E94560", radius:24}
Line:   {id:"div",   type:"line",  z:3,  x1:80, y1:600, x2:1000, y2:600, stroke:"#333", stroke_width:2}
Ellipse:{id:"dot",   type:"ellipse",z:8, pos:[500,500,80,80],  fill:"#E94560"}
Icon:   {id:"ico",   type:"icon",  z:9,  pos:[880,80,64,64],   icon:"star", color:"#E94560"}
Group:  {id:"grp",   type:"group", z:6,  pos:[80,80,400,300],  layers:[...]}

## Auto-layout (declarative layout — DON'T hand-compute child x/y)
For complex designs (cards, grids, rows, sections) use a container. Give the
CONTAINER a pos:[x,y,w,h]; give each CHILD only its width+height (the engine
flows child x/y for you).
Row:    {id:"feats", type:"row",    pos:[80,400,920,300], gap:24, justify:"space-between", layers:[...]}
Column: {id:"side",  type:"column", pos:[80,80,300,900],  gap:16, align:"center",          layers:[...]}
Grid:   {id:"gal",   type:"grid",   pos:[80,80,920,800],  gap:20, layers:[...]}   (wraps to rows)
Fields: direction(row|column) · gap · padding · align(start|center|end|stretch) ·
        justify(start|center|end|space-between|space-around) · wrap · fill · radius
Example — 3 feature cards in a row, each a column of icon+title+body:
  {id:"row", type:"row", pos:[60,500,960,360], gap:30, layers:[
    {type:"column", width:300, height:360, gap:12, padding:24, fill:"#16213E", radius:16, layers:[
      {type:"icon", width:48, height:48, icon:"zap", color:"#E94560"},
      {type:"text", width:252, height:40, text:"Fast",  size:32, weight:700},
      {type:"text", width:252, height:120, text:"Sub-100ms renders.", size:20}]},
    ... ×3 ]}

## Repeat (one template × N — don't copy-paste layers)
repeat:N → N copies (ids <id>_1..N); {{i}} = 1-based index.
repeat:[{...},{...}] → one copy per row; {{key}} tokens fill from the row.
  {id:"plan", type:"column", repeat:[{name:"Free",price:"$0"},{name:"Pro",price:"$9"}],
     width:280, height:360, layers:[{type:"text", width:240, height:50, text:"{{name}} {{price}}", size:30}]}
Combine with a row/grid container to lay out the copies automatically.

## Presets (engine owns the layout — you supply only content)
feature_grid: a complete feature poster in ONE layer — title, subtitle, and a
row of cards. You give content + colors; the engine positions everything (no
coordinates to get wrong). Best way to build a feature/benefit poster.
  {type:"feature_grid", pos:[0,0,1080,1080], bg:"#0A0A0A", accent:"#FF3D00", text_color:"#FAFAFA",
    title:"Nova", subtitle:"Your next-gen companion",
    items:[
      {icon:"zap",          title:"Fast Sync",   desc:"Instantly sync across devices"},
      {icon:"calendar",     title:"Smart Planner",desc:"AI-driven scheduling"},
      {icon:"shield-check", title:"Secure Vault", desc:"End-to-end encrypted"}]}
  Optional: card_fill, accent (icon), text_color, muted. Prefer a FLAT bg hex over
  bg:"gradient" — a flat canvas + one accent reads designed, not AI-generated.

decor (aliases marble_bg, backdrop): a soft, designed BACKGROUND in ONE layer.
style:"marble" (default) = radial-gradient blobs clustered in the corners (each
fades to the canvas color at its rim, so text on top stays readable) + veins +
rings + dots. style:"mesh" = a calmer gradient-mesh wash. Use it as your FIRST
layer instead of hand-placing ellipses (which collide, go off-canvas, or lose
their fill). Then add content on top with a HIGHER z. It's a GENERATOR, not a
fixed look — vary style/palette/accent/corners/intensity per design; don't ship
the same backdrop twice.
  {type:"decor", style:"marble", pos:[0,0,1080,1350], bg:"#F3EEF6", accent:"#6231C9",
    palette:["#B9C4F0","#C9B6EC","#A6DAE8","#F6CBA6"], corners:["tr","bl","br"],
    intensity:0.7, veins:true, rings:1, dots:1}
  All fields optional (shown = defaults). corners ⊂ tl/tr/bl/br · intensity 0.2–1.

editorial (alias poster): a complete text-forward editorial poster in ONE layer —
kicker · rule · big headline · deck · body · footer, left-anchored with a held
margin and ONE accent (the art-directed look). Engine sizes & stacks everything.
  {type:"editorial", pos:[0,0,1080,1350], bg:"#FAF5EC", accent:"#B8543C", text_color:"#1A1A1A",
    kicker:"Field Notes — No. 04", title:"The quiet craft of editorial layout",
    subtitle:"One-line deck under the headline.", body:"Supporting paragraph…", footer:"folio / 2026"}

split: a two-panel editorial layout — a color/PATTERN block on one side, kicker +
big headline + deck vertically centered on the other. side:"left"|"right",
ratio: number or "golden" (0.382). panel can be a hex OR a pattern/image fill.
  {type:"split", pos:[0,0,1200,800], side:"left", ratio:"golden", panel_label:"04",
    panel:{type:"pattern",pattern:"halftone",fg:"#FAF5EC",bg:"#B8543C"}, panel_text:"#FAF5EC",
    bg:"#FAF5EC", accent:"#B8543C", kicker:"Case Study", title:"Headline here", subtitle:"Deck."}

list (aliases steps, checklist, numbered_list): a numbered/stepped vertical list — the
right tool for "N tips/steps/reasons/habits". Engine MEASURES each item (title + desc) and
distributes them with even rhythm under an auto-sized headline; accent marker in the gutter.
NEVER hand-place a list (the headline wraps and buries item 1). items=[{title,desc,icon?}].
  {type:"list", pos:[0,0,1080,1350], bg:"#FAF5EC", accent:"#B8543C", text_color:"#1A1A1A",
    kicker:"Field Notes", title:"5 Habits…", marker:"number", footer:"folio / 2026",
    items:[{title:"Write Small Tests", desc:"One thing, fast feedback."}, …]}
  marker:"number"(01,02…)|"bullet"|"icon"(uses item.icon)|"none". kicker/footer optional.

stat (aliases metric, big_number): ONE dominant statistic poster — a huge auto-sized
number (the single accent moment), a small kicker above, a one-line caption below.
Engine sizes the number to dominate, so the focal hierarchy can't be weak. Use this for
any "X% of …" / single-figure poster instead of hand-placing a giant number (which
overflows + collides with the caption).
  {type:"stat", pos:[0,0,1080,1350], bg:"#0A0A0A", accent:"#FF3D00", text_color:"#FAFAFA",
    kicker:"Maker Report 2026", stat:"73%", caption:"of side projects never ship.", footer:"folio"}

event (aliases flyer, hero): a bold event/announcement poster — a BIG auto-sized title,
a stack of detail lines (date/venue/time), engine-placed accent bars in the margin, footer.
The block is vertically centered so it fills the canvas. Use this for a gig/launch/flyer
instead of hand-placing a giant title (it collides with the details + the decor lands
invisible). details=[…] OR date/venue/time fields. palette=[…] colors the bars.
  {type:"event", pos:[0,0,1080,1350], bg:"#0A0A0A", accent:"#FF3D00", palette:["#00E5FF","#FF00E5","#C6FF00"],
    title:"Neon Nights", details:["Saturday 14 June","Riverside Park","7PM till late"], footer:"@neonnights"}

## Data-viz + reuse
Chart:     {type:"chart", chart:"bar"|"line"|"area"|"pie"|"donut", pos:[..], data:[{x,y}..]}
           (label/value/name/count also map to x/y; or pass a raw vega-lite spec:{...})
KPI:       {type:"kpi_card", pos:[..], label:"Revenue", value:"$1.2M", delta:"+12%", icon:"dollar-sign", fill:"#16213E"}
Component: {type:"component", pos:[..], ref:"<saved-id>", slots:{...}}  (make one via save_as_component)
  NOTE: chart + kpi_card render in the editor & HTML export but NOT in PNG (they use foreignObject).

Text shorthand fields:  text, font, size, weight, color, align, line_height, letter_spacing, text_decoration:"underline"|"line-through"
  font = any family ("Playfair Display","Bebas Neue","Inter","IBM Plex Mono"…) — set it per layer for real type hierarchy.
  line_height (alias lh): 1.0–1.05 tight display, 1.5 body.  letter_spacing (alias track): -2..-1 big headlines, +1.5 uppercase mono labels.
  Aliases accepted: content→text, font_size→size, symbol→icon, url/href→src, lh→line_height, track/tracking→letter_spacing.
Fill shorthand:         "#hex" | "rgba(r,g,b,a)" | {type:"linear",angle:135,stops:[{color:"#a",position:0},{color:"#b",position:100}]}
  (position is 0–100; "gradient"/pos:0-1 are tolerated and normalized)
Stroke shorthand:       "#hex" or {color:"#hex",width:2,dash:[4,2]}
Image:  use a real https:// URL only — a local filename renders a placeholder.
Icon:   icon:"<real-lucide-name>" — unknown names render a labeled placeholder.
Base fields (all types): opacity:0-1 · rotation:deg · flip_h:bool · flip_v:bool · locked:bool

## Texture & variety (use these instead of defaulting to gradients — they read DESIGNED)
Pattern fill: any fillable layer → fill:{type:"pattern", pattern:"<name>", fg:"#hex", bg:"#hex"?, scale?, angle?, weight?, opacity?}
  also terse: fill:"pattern:halftone" or fill:"dots/#222 on #FAF5EC".
  names: dots dot_grid grid graph_paper isometric stripes diagonal_stripes crosshatch
         checkerboard chevron zigzag triangles waves scallop plus cross scatter confetti
         halftone blueprint carbon houndstooth brick.  (e.g. a halftone or crosshatch
         field beats a navy→purple gradient for an editorial look.)
Image/texture fill: fill:{type:"image", src:"https://…", mode:"tile"|"cover"|"contain"}
Effects (any layer, esp. images): effects:{duotone:{shadow:"#1B1B3A",highlight:"#F5C518"}, grain:0.4,
         posterize:4, saturate:1.2, blend_mode:"multiply", backdrop_blur:12}
  duotone = the signature editorial photo treatment (two-tone luminance map).

## Shapes (parametric — type is the shape name; fills/strokes/effects like any layer)
{type:"star", pos:[..], color:"#FF3D00", points:5, inner_ratio:0.4}
  also: burst/seal (badge sunburst, points:20) · blob (organic, seed:N) · wave (cycles:N) ·
  arc (open stroke; start/end deg) · ring/donut (thickness:0.4) · bubble/speech_bubble ·
  heart · lightning/bolt · shield · gear/cog (teeth:8) · arrow · cross_shape.
  e.g. {type:"blob", pos:[700,120,260,260], color:"#3F5E4A", seed:2} as an organic accent shape.

## Type effects (on any text layer)
uppercase:true (or transform:"capitalize") · italic:true · outline:{color:"#000",width:3} ·
highlight:"#FDE047" (marker band) · variation:{wght:350,wdth:80} (variable-font axes) ·
features:{tnum:1,smcp:1} (OpenType) · curve:"M0 80 Q100 0 200 80" (text along a path).`,

  layers: `# Layer Types — Required Fields
rect      id type z x y width height    + fill? stroke? radius? opacity?
text      id type z x y width           + content:{type:"plain",value:"..."} style:{font_size,color,weight?,align?}
image     id type z x y width height src
ellipse   id type z x y width height    + same optionals as rect
line      id type z x1 y1 x2 y2         + stroke? stroke_width?
group     id type z x y width height layers[]
icon      id type z x y width height icon   (icon = lucide name e.g. "star","heart","arrow-right")
component id type z x y width height ref    (ref = component ID from components/index.yaml)

Notes:
- id must be unique within the design (use slugs: "bg","hero","title-1")
- z is required — use 0=background, 5=images, 10=text, 15=decorators, 20=overlays
- All coordinates in px; origin is top-left corner
- opacity: 0.0–1.0 (default 1.0)
- radius: number (uniform) or [tl,tr,br,bl] (per-corner)`,

  workflow: `# Workflow Details

next_action protocol:
  Every write tool returns next_action:{tool,params,remaining,hint}
  ALWAYS call next_action.tool as your very next tool call.
  remaining==0 → sequence complete (usually seal_design or export_design)
  remaining>0  → more pages/steps needed

handover protocol:
  Every response includes handover:{workflow_step,workflow_next,suggested_next[],carry_forward}
  workflow_step: PROJECT→DESIGN→COMPOSE→SEAL→EXPORT
  suggested_next: 3 concrete next tools with pre-filled params — pick the most appropriate
  carry_forward: params to re-use in your next call

Context reset recovery:
  1. Call resume_task(task_path) → get exact next tool + params
  2. Or call resume_design(design_path) → check carousel progress
  3. Or call list_tasks(project_path) → find task_path if lost

Patch workflow (editing sealed designs):
  1. patch_design(design_path, selectors=[{path,value}], dry_run=true)  ← validate first
  2. patch_design(design_path, selectors=[{path,value}])                ← apply
  3. seal_design(design_path)

Interactive HTML reports (dashboards, EDA, financial decks):
  USE layout:"flow" — a responsive editorial document (12-col grid, NO fixed canvas).
  Layers are placed by a span field (1–12), NOT x/y/width/height — they reflow on any screen.
  1. generate_report(project_path, name, layout:"flow", accent:"#f5c842",
       font_heading:"Playfair Display", font_body:"Inter", max_width:1200,
       pages:[{id:"overview",label:"Overview"}], data_sources:[{id:"rev",type:"inline",rows:[…]}])
  2. bind_data(design_path, datasets:[{id, rows:[…]}])   ← add/replace datasets anytime
  3. add_layers(design_path, page_id, layers:[ …flow widgets, each with a span… ])
       hero/headings → {type:"rich_text", span:12, font_family:"Playfair Display", font_size:42, content:"**Title**", format:"markdown"}
       KPI row       → {type:"kpi_card", span:3, label, value, format:"currency"|"number"|"percent", delta, sparkline_data, sparkline_field}
       charts        → {type:"interactive_chart", span:6|8, height:340, chart_type:"line"|"bar"|"area"|"pie"|"donut", data_ref, x_field, y_field, title}
       data table    → {type:"interactive_table", span:12, data_ref, filterable:true, exportable:true, pagination:true, page_size:10,
                         columns:[{field,title,sortable:true,formatter:"currency"|"number"|"percent"|"badge"|"delta",align:"right"}]}
  4. validate_report(design_path) → {ok, errors, warnings, diagnostics[]} — LINT cross-refs
     (every chart/table data_ref + x/y field resolves to a real dataset, buttons open existing
     modals, transforms group by present fields). Run it after add_layers; fix errors before export.
  5. export_report(design_path, theme:"dark"|"light") → self-contained .report.html
     (also returns diagnostics; resolves transform datasets at export).
     ★ DELIVERABLE: export_report returns view_url — a tokenized link that renders the
       FINAL interactive HTML directly in the browser. Give the user THAT, not the editor
       link. The editor canvas is an authoring view, not a faithful preview of the export;
       export_report.view_url is the real result. (edit_url is also returned for editing.)
  Defaults if span omitted: kpi=3, chart=6, table/rich_text=12. accent seeds chart colors + links.
  Tables sort/filter/paginate/CSV-export client-side; charts use Chart.js (CDN). All in one HTML file.
  DATA SOURCES (bind_data datasets[] or report.data.sources): type:"inline" {rows:[…]} ·
  "json"/"csv" {path} · "query" {engine:"http", url, query?:"dot.path"} fetches JSON (sql/duckdb
  need a server connector) · "transform" {from:"<srcId>", group_by, agg:"sum|avg|min|max|count",
  value} = a derived group-by aggregation, chart-bindable as data_ref (x=group_by, y=value).

Interactive components (flow reports — all in add_layers, each takes span + the fields below):
  button       → {type:"button", span:3, label, variant:"solid"|"outline"|"ghost"|"link", action:"open_modal:<id>"}
                 action sugar: open_modal:<id> · close_modal · toggle:<key> · set:<key>=<val> · filter:<field>:<val>
                 · tab:<group>:<id> · accordion:<id> · scroll_to:<id> · download_csv:<tableId> · open_url:<url> · goto_page:<id>
  popup(modal) → {type:"popup", id:"<id>", modal:true, title, body:"markdown"  (OR layers:[…children])}  — hidden; opened by a button action open_modal:<id>
  tabs         → {type:"tabs", span:12, variant:"underline"|"pills", tabs:[{label, layers:[…children with span]}]}  — within-page tabbed panels
  accordion    → {type:"accordion", span:12, exclusive:true, items:[{title, body:"markdown" OR layers:[…], open:true}]}
  filter_bar   → {type:"filter_bar", span:12, field:"sector", multi:true, label, options:[…] OR options_from:"<data_ref>", style:"chips"|"dropdown"}
                 LINKED: selecting filters every interactive_table + interactive_chart on the page by that field, live.
  toggle       → {type:"toggle", span:4, state_key:"view", label, options:["A","B"]}  — segmented; writes to shared state
  callout      → {type:"callout", span:12, variant:"info"|"success"|"warning"|"danger", title, content:"markdown"}
  progress     → {type:"progress", span:4, label, value:72, max:100, style:"bar"|"radial", unit:"%"}
  tooltip      → {type:"tooltip", span:2, icon:"i", content:"markdown shown on hover"}
  These render in the editor canvas too (studio-editable). Containers (tabs/accordion/popup) hold child layers that each take their own span.
  Studio editing of flow layers: charts + tables render real previews on the canvas; drag a component body to REORDER it, drag side handles to set its span (1–12, snaps to the grid), drag the bottom handle to set an explicit row height. In the Properties panel, flow layers expose Span + Height (not x/y). Set an explicit height via the flow_h field (e.g. {type:"interactive_chart", span:8, flow_h:420, …}); otherwise height auto-estimates per type.

Token budget for local models:
  Gemma 4B  128K ctx → 5–8 layers/page, guide once per session
  Qwen 9B    64K ctx → 4–6 layers/page, load guide sections only
  Qwen 2B    32K ctx → 3–4 layers/page, shorthand section only
  Output cap: 1K tokens/turn — use layers_shorthand always`,

  reference: `# Reference-Image → Design
When the user attaches a design to MATCH ("make it like this", "match this Canva poster"):

YOU already SEE the image — describe it precisely. extract_reference handles the
2 things you guess badly: EXACT pixel dimensions and a role-mapped PALETTE.

Loop:
  1. extract_reference(colors:[…hex you see…], image?:<data: URL | local path>, project_path?, name?)
       colors  = the 4–8 main hex you observe (most reliable input).
       image   = a data: URL or local file path → exact dimensions (+ exact colors for SVG).
                 https URLs are NOT fetched — pass observed colors instead.
       → returns: canvas (recommended Folio size), palette {bg,surface,text,accent,secondary,border},
         palette_spec, mood, and a step-by-step brief. Follow next_action.
  2. create_design(project_path, name, width, height)  ← use the recommended canvas
  3. add_layers(design_path, layers_shorthand=[…])  ← rebuild the reference as NATIVE layers:
       • LAYER 1 = the full-canvas background from starter_layers (the EXACT bg hex) — NEVER
         leave the canvas white when the reference is dark. This is the #1 failure to avoid.
       • Map each visual block: eyebrow→mono text · headline→big display text (4–5× body) ·
         body→text · cards/benefits→ONE feature_grid · logo/photo→image(src)/icon · divider→thin rect.
       • Match the LAYOUT (alignment, hierarchy, column count, whitespace) and TYPE category
         (serif→"Playfair Display" · grotesk→"Space Grotesk"/"Inter" · mono labels→"IBM Plex Mono").
       • Use the EXACT palette hex from step 1 — flat bg, ONE accent. Every text color must contrast
         with the block under it (a colored chip must be WIDER than its label, or the text spills onto
         the canvas and vanishes). add_layers returns notes:[…] flagging invisible text / off-canvas
         layers — fix every note before seal_design.
  4. seal_design → export_design.

Rebuild as layers (editable), NOT as a single image layer of the screenshot — the point is an
editable Folio design that matches the reference, not a pasted picture.`,
};

export function buildGuide(section?: string): string {
  if (section && section in SECTIONS) return SECTIONS[section];
  if (section) return `Unknown section "${section}". Available: ${Object.keys(SECTIONS).join(' | ')}`;
  return SECTIONS['quick_ref'];
}

export const GUIDE_SECTIONS = Object.keys(SECTIONS);
