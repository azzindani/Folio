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
     "Source Serif 4"/"Inter" · LABELS "IBM Plex Mono"/"JetBrains Mono".
   • Tight headlines: lh:1.0–1.05, track:-1..-2. Mono labels: UPPERCASE, track:1.5.
   • ONE accent color, used 1–2× (a stat, a rule) — never on everything.
   • ASYMMETRY + whitespace: left-anchor at x:80–100, leave a column empty. Don't
     center everything. Depth via a 2–4px RULE/line, NOT glows or soft shadows.
   • radius: 0 (editorial/print) OR 999 (pills) — avoid the 8–16 "templated" middle.

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
        size:27, color:"#2A2218", font:"Source Serif 4"},
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
  - Load guide sections on demand: shorthand | layers | workflow

🎨 Make it RENDER (avoid blank posters):
  - NO photos: you can't supply image files. A bare src like "coffee.jpg"
    shows a placeholder frame. Build visuals from rect/ellipse/line/icon +
    fills/gradients instead. Only use type:"image" with a real https:// URL.
  - Icons: use a real name (star, heart, check, user, mail, image, arrow-right,
    map-pin, zap, award, calendar, phone, shopping-cart). Unknown names render
    as a labeled placeholder. Synonyms are tolerated (photo→image, gear→settings).
  - Put real copy in every text layer — empty text renders nothing.
  - add_layers returns notes:[…] when something won't render as intended —
    read them and fix in your next call.`,

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
Base fields (all types): opacity:0-1 · rotation:deg · flip_h:bool · flip_v:bool · locked:bool`,

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

Token budget for local models:
  Gemma 4B  128K ctx → 5–8 layers/page, guide once per session
  Qwen 9B    64K ctx → 4–6 layers/page, load guide sections only
  Qwen 2B    32K ctx → 3–4 layers/page, shorthand section only
  Output cap: 1K tokens/turn — use layers_shorthand always`,
};

export function buildGuide(section?: string): string {
  if (section && section in SECTIONS) return SECTIONS[section];
  if (section) return `Unknown section "${section}". Available: ${Object.keys(SECTIONS).join(' | ')}`;
  return SECTIONS['quick_ref'];
}

export const GUIDE_SECTIONS = Object.keys(SECTIONS);
