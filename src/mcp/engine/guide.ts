// Engine reference guide — split into sections to stay within 1K output budget.
// Default section (quick_ref) ≈200 tokens. Full guide = 4 calls ≈800 tokens total.
import { isMinimalGuidance } from '../guidance-mode';
import { craft, CRAFT_SECTIONS } from './craft';
import { ASSETS_GUIDE } from './guide-assets';
import { STYLE_GUIDE } from './guide-style';
import { MOTION_GUIDE } from './guide-motion';
import { WORKFLOW_GUIDE } from './guide-workflow';

const SECTIONS: Record<string, string> = {
  motion: MOTION_GUIDE,

  quick_ref: `# Folio Quick Ref
Canvas: 1080x1080 (sq) · 1080x1350 (port) · 1920x1080 (land) · units: px
Design types: poster (single page) | carousel (multi-page)
z = stacking order (higher = front)

1️⃣ ONE design per request — THE DEFAULT. Produce EXACTLY ONE design and stop. Do NOT
   volunteer extra "options"/"variations"/"versions" — generating several unasked wastes
   the user's time + tokens and is a bug, not helpfulness. Make MORE than one ONLY when the
   user EXPLICITLY asks ("give me 3 options", "a few variations", "2 versions"); then make
   exactly the number asked (use enrich_brief variant:0,1,2… — one call per option). A
   carousel/deck is still ONE design (multi-page), not multiple designs. When unsure: ONE.
   ⚠️ OPTIONS / "different concepts" / "different moods" must be STRUCTURALLY different —
   a DIFFERENT layout per option (a centered type-stack vs a split-canvas vs a cornered
   asymmetric vs a full-bleed band), a different type treatment + composition + palette.
   The SAME preset recolored with swapped copy is NOT 3 options — "cute" and "creepy" can't
   be the same serif event card on two background tints. Reach past the one safe preset:
   hand-build at least some, or pick a different preset per option, so they read as
   genuinely distinct designs, not one template ×N.

📦 A SET of N (the user NAMED a count — "5 quote cards", "12 monthly posters", "a card
   per weekday", "a cover for each of the 6 episodes"): produce ALL N. Stopping at a
   sample of 2-3 is a FAILURE — the user asked for the whole set. Same style/topic,
   different content per item → design ONE item well (the look), then for EACH remaining
   item manage_design(op:duplicate) it and patch_design the per-item content (or, for a clean
   slot-driven set, templates(op:export) the first then templates(op:batch) with the N content sets).
   Hold the shared look constant; vary ONLY the per-item content. Don't leave each card
   near-empty ("Jan / plan") — give every one of the N the same richness as the first.

✏️ EDIT / RESTYLE an existing design ("make it darker", "flip to a pastel palette",
   "boxier", "airier", "declutter"): a rename is NOT an edit — you MUST change the
   actual design. For a RECOLOR/restyle, read the design's current hexes (manage_design(op:inspect)
   or read it), then patch_design with ONE {path:"recolor", value:{"#OLD":"#NEW", …}}
   selector mapping every bg/text/accent hex to its new shade — that swaps the whole
   palette in one call. (themes(op:apply) does NOT recolor a design; it only sets the project
   default, and designs use baked-in hexes.) For structural edits (airier/declutter →
   remove layers + add whitespace; boxier → swap radii, add panels) use edit_layer(op:remove) +
   add_layers / edit_layer(op:update). If asked for BOTH versions, manage_design(op:duplicate) first, then
   edit the copy — and make the two genuinely different, not identical files renamed.

🧠 SHORT or vague prompt (e.g. "a poster about remote work", "a 6-slide carousel on X")?
   Call enrich_brief FIRST. Single design → best preset + a full content outline
   (the richness floor). CAROUSEL/deck/slides → output_type:"carousel" + a per-page
   plan (pages:[{role,label,preset,hints}], cover→content→data→takeaway) with ONE
   shared bg_style/palette across pages. Either way it returns a topic-matched
   bg_style/palette and — for factual topics — web-research queries to run before
   composing (figures REAL, not invented). Follow its instruction: research if
   asked, then create_design+add_layers (poster) or tasks(op:create)+append_page
   (carousel). Don't ship sparse output when the topic deserves a dense, researched one.

🖼️ RICHNESS — FILL THE PAGE (the #2 quality gap after AI-slop). A headline + two
   lines on an empty canvas reads as a DRAFT, not a finished piece. For any
   CONTENT brief (infographic, newsletter, timeline, how-to, guide, report, menu,
   tips, process, "by the numbers", journey, mind-map) the bar is a DENSE,
   ILLUSTRATED document — like the examples gallery, not a lone headline:
   • NO DEAD SPACE: content (or a deliberate full-bleed shape/texture/band) reaches
     all four margins. If half the canvas is empty, add a section / data-viz block /
     sidebar — or size the canvas down to the content. Never ship the void.
   • BUILD A PICTURE: carry VISUALS, not just text — an icon per point, a
     chart/donut/bars for any number, a connector path or numbered nodes for a
     sequence, framed cards, a patterned or two-tone background.
   • COLOR: 2–4 hues working together (bg + 2 accents + a neutral), not one accent
     on mono. • STRUCTURE: reach for the rich preset — sections (multi-block),
     feature_grid, timeline, mindmap, journey — over a single text layer.
   Plain SIGNAGE (a shop sign, one short announcement) stays minimal; this is for
   content-rich briefs, where sparse = unfinished.

⚠️ EVERY sized layer (rect, image, ellipse, icon, group, chart, kpi_card…)
   MUST have a positive width AND height — or use pos:[x,y,w,h]. Without
   dimensions the layer renders INVISIBLY. add_layers now rejects 0-dim
   layers with a clear error, but get it right first to save round-trips.

🔒 HAND-PLACING A DELIBERATE COMPOSITION? Loose hand-placed layers are treated
   as mistakes to auto-rescue (the engine re-measures, reflows + re-lights them).
   To keep your EXACT placement + colors (intentional overlap, off-canvas bleed,
   a stamp, a knockout on a band, a rotated element), wrap the primitives in ONE
   group {type:"group", x:0, y:0, width:W, height:H, layers:[…]} OR set locked:true
   on the layer/group — then the engine preserves your layout untouched. Tilt any
   layer with rotate:<deg>. If you compose LOOSE and the engine rescues something
   you meant, add_layers' \`notes\` flags it ("🔒 Auto-healed N…") and points right
   back here — then wrap+lock and re-send. You can SEE the result: render_preview
   returns an inline PNG, so compose → look → lock what's deliberate → iterate.
   (Load the \`layers\` guide section for the full frontier-composition toolkit:
   rotation, locked dashboards, colored data viz.)

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
   • CATALOG PACKS: themes(op:packs, kind:"palette"|"type", search:"<vibe>") → an
     id → ready hexes / heading·body·mono families for layer fills + fonts.
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
   The grid also takes layout:"rows" (full-width editorial rows: marker left, copy right) or
   "cards" (the tiled default) — vary it so two feature posters don't share a silhouette.

🧱 STRUCTURE MATCHES MEANING — feature_grid is NOT the answer for everything. A card grid
   flattens content that has its own shape. Reach for the matching preset instead:
   • a comparison / "X vs Y"        → versus  (a true split, not cards)
   • a history / roadmap / timeline → timeline (a connected spine, not cards)
   • pricing plans / tiers          → pricing  (tier columns + a featured tier, not cards)
   • steps / "N tips/reasons"       → list    (numbered rhythm, not cards)
   • a mind map / brainstorm        → mindmap  (a hub + branches OR a linked card chain
                                       + curved connectors + doodles; layout:"spokes"|"chain")
   • a newsletter / bulletin        → newsletter (bordered masthead + lead + a masonry
                                       of section boxes + footer)
   • brand / core VALUES            → value_list (big rotated margin numbers + dividers)
   • social-media "tips" cards      → ribbon_cards (a grid of ribbon-banner cards with
                                       corner number badges)
   Using a card grid for these is the #1 reason outputs look same-y. Match the structure.

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

📰 A DATA / REPORT / INFOGRAPHIC? (a "state of X", a "by the numbers", a report or explainer
   built from real figures, sections and paragraphs) — use the sections PRESET (aliases
   infographic/document) on a TALL canvas (1080x1920+). ALWAYS give it a header — kicker + title
   (the poster's headline; don't put it inside blocks) — THEN an ordered blocks:[{kind:…}] list
   (intro/stats/heading/text/list/callout/quote/divider). The engine measures + flows every
   block with editorial rhythm; never hand-place a multi-section document (it collides badly).
   ⚠️ SIZE THE CANVAS TO THE CONTENT: budget ~280px of height per block (a stats row or bars
   counts as one). 6 blocks → ~1080x1900, 8 blocks → ~1080x2400, 10 → ~1080x2900. Keep block
   bodies to ~2 sentences; when in doubt make the canvas TALLER (the engine distributes slack).

   ⛔ sections is NOT the default. It is ONLY for briefs that genuinely ARE a data/report piece.
   MATCH THE PRESET TO THE BRIEF — a sign, flyer, invite, save-the-date, birthday, announcement,
   "now open", "sold out", a lost-pet notice, a celebration → an EVENT or EDITORIAL poster (a
   headline + a few details), NOT a sections infographic. A quote/manifesto/essay/cover → EDITORIAL.
   🚫 NEVER fabricate a stats row, a pie/bar chart, or a "Source:" line to fill a sections skeleton
   when the brief carries no data — a wedding save-the-date does NOT get a donut chart of "Love 40%".
   If the brief has no figures, it is almost certainly an event/editorial/list poster, not sections.

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
  1. tasks(op:create, project_path, task_name, brief, pages=[{label,hints}])
  2. append_page(design_path, page_id, layers_shorthand=[…], task_path=…)
     → repeat until next_action.remaining==0 (each call returns open_url for the new page)
  3. seal_design(design_path)

Rules:
  - Always use layers_shorthand (verbose works too but is 5× the tokens)
  - Every sized layer needs pos:[x,y,w,h] OR width+height — no exceptions
  - Always pass task_path in append_page — enables auto-handover
  - Call tasks(op:resume, task_path) after any context reset
  - 3–8 layers per page is ideal
  - Load guide sections on demand: shorthand | layers | workflow | reference | motion (animation)
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
    with a fix; FIX EVERY error then re-run it until zero errors. edit_layer(op:align) fixes
    alignment; render_preview(design_path) returns a PNG so you can SEE the result.
    Fix → re-check → seal.

🎨 CRAFT (universal taste rules — read once): get_engine_guide({section:"craft"}) for the
   3-axis model (preset=shape · theme=brand · craft=universal) + the 80/20 soul rule +
   the identifiability test. Sub-rulebooks: "anti_slop" (the AI tells to avoid — default
   indigo, purple→blue gradient, emoji-icons, invented metrics), "color" (ONE accent,
   neutrals 70–90%), "type" (one entry point, 3–5× headline), "ux_laws", "a11y".`,

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

## Presets — how much canvas each one needs
A preset sizes its type from the box WIDTH and grows DOWNWARD to fit its content.
So a WIDE box is an expensive box: at width 1920 the type, margins and gaps all
scale up, and the content gets TALLER, not shorter. This is the single most common
way a landscape slide goes wrong.

Minimum height, as a multiple of the box WIDTH (typical content load):
  sections/infographic/document/report_poster  1.05× W   ← the tallest
  newsletter/bulletin/digest                   1.10× W
  editorial/poster                             1.00× W
  event/flyer/hero                             0.95× W
  feature_grid                                 0.90× W
  pricing/plans/tiers · ribbon_cards           0.85× W
  list/steps/checklist · timeline/roadmap      0.82× W
  versus/compare · mindmap · value_list        0.80× W
  split                                        0.75× W
  stat/metric/big_number                       0.60× W   ← the only safe 16:9 one

Read that as: on a 1920×1080 slide, sections wants ~2016px of height and has
1080. On a 1080×1350 portrait poster it wants ~1134px and has 1350 — comfortable.

What the engine does about it:
• POSTER (single page): the canvas is elastic. The preset content-sizes and the
  document resizes to match, so an over-tall preset is auto-fit, not a clip.
• SLIDE/PAGE (carousel, presentation): the canvas is FIXED. The preset is
  compressed into the box you declared — type, spacing and geometry shrink
  together — and the response tells you the scale it needed. Below 0.55× it stops
  compressing, reports the remaining overflow, and diagnose_design raises an
  off_canvas ERROR. Compression is a rescue, not a plan: at 0.7× the type is 70%
  of its intended size, and the deck reads visibly squeezed.

For a 16:9 slide, prefer in this order:
  1. columns — put the presets side by side. Each child gets a FULL-HEIGHT
     column, so on 1920×1080 two columns hand each preset ~930×1080: portrait,
     which is the shape every preset was built for. The overflow problem stops
     being a problem instead of being compressed away.
       {type:"columns", pos:[0,0,1920,1080], gap:60, cols:[
         {type:"stat", value:"7.97M", label:"tons", bg:"#0A0A0A", accent:"#FF3D00"},
         {type:"list", items:["Belly capacity recovered", "Freighter share fell",
                              "Yields normalised"], bg:"#0A0A0A"}]}
     gap (default 56) · pad (default 0) · weights:[2,1] for an uneven split.
     Children go through the normal pipeline, so a column takes ANY layer — a
     preset, a group, a bare rect — and columns nest inside columns. A child
     that sets its own pos keeps it.
  2. LESS per slide — 2-3 blocks, one idea. Split across pages (append_page).
  3. split or stat — the two presets whose natural shape is already wide.
  4. Let it compress — acceptable down to ~0.85×, visibly squeezed below that.

columns is GEOMETRY, not a look: it decides where the boxes are and nothing
about what goes in them. Two decks built with it should not resemble each other
unless you made them resemble each other.

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

sections (aliases infographic, document, report_poster): the RICH, content-DENSE poster —
a header (kicker/title/subtitle) then an ordered blocks:[…] the engine MEASURES and flows
top-to-bottom with editorial rhythm + footer. Use a TALL canvas (1080x1920+). Each block:
  {kind:"intro", text:"…"}            一 lead paragraph
  {kind:"stats", items:[{value:"58%",label:"hybrid"},…]}   一 a row of big figures (≤4)
  {kind:"heading", text:"…"}          一 section heading (accent tick)
  {kind:"text", text:"…"}             一 body paragraph
  {kind:"list", items:[{title,desc},…]}  一 numbered sub-list
  {kind:"bars", items:[{label:"Mobile",value:62},{label:"Desktop",value:31}]}  一 native bar chart (renders in PNG)
  {kind:"callout", label:"Key takeaway", text:"…"}  一 accent-tinted highlight box
  {kind:"quote", text:"…", cite:"…"}  一 pull quote
  {kind:"source", text:"Source: …"}   一 small mono source/caption line (footer credit)
  {kind:"divider"}                    一 rule
  {type:"sections", pos:[0,0,1080,1920], bg:"#FAF5EC", accent:"#B8543C", kicker:"Report",
    title:"The State of Remote Work 2026", subtitle:"…", footer:"Source: …", blocks:[
      {kind:"intro",text:"…"}, {kind:"stats",items:[{value:"58%",label:"hybrid"},{value:"27%",label:"remote"}]},
      {kind:"heading",text:"The Hybrid Default"}, {kind:"text",text:"…"},
      {kind:"callout",label:"Takeaway",text:"…"} ]}
  This is THE tool for a magazine infographic / multi-section report — supply many blocks
  for a dense, organized, professional layout; don't hand-place sections (they collide).

timeline (aliases roadmap, history, milestones): a connected chronological SPINE — a continuous
accent line threaded through node dots, each entry's date heroed in the accent with a title +
blurb beside it. THE tool for a history / roadmap / process-over-time — do NOT use feature_grid
(a row of cards throws the chronology away). items=[{date,title,desc}].
  {type:"timeline", pos:[0,0,1080,1350], bg:"#FAF5EC", accent:"#B8543C", kicker:"Since 2015",
    title:"Company History", items:[
      {date:"2015", title:"Founded", desc:"Two people, one garage."},
      {date:"2019", title:"Series A", desc:"Scaled to 40 people."}, …]}

pricing (aliases plans, tiers): a real pricing TABLE — tier columns side by side, each a heroed
price + period + checked feature list, and ONE featured tier lifted taller with an accent fill +
"MOST POPULAR". THE tool for plans/tiers — do NOT use feature_grid (it loses the price hierarchy
+ featured emphasis). plans=[{name,price,period,features:[…],featured?}]; flag the hero tier
featured:true (else the middle one is heroed).
  {type:"pricing", pos:[0,0,1080,1350], bg:"#0A0A0A", accent:"#7C5CFF", title:"Simple Pricing",
    plans:[
      {name:"Basic", price:"$10", period:"/mo", features:["10 users","Email support"]},
      {name:"Pro", price:"$20", period:"/mo", featured:true, features:["100 users","Priority support","Analytics"]},
      {name:"Team", price:"$40", period:"/mo", features:["Unlimited","Dedicated CSM"]}]}

versus (aliases compare, vs): a true two-column SPLIT — A vs B headers either side of a center
divider + a VS medallion, then per-aspect rows (label centered, A value left, B value right). THE
tool for "X vs Y" — do NOT use feature_grid (a card grid hides the head-to-head). Provide
a:{label}, b:{label}, rows:[{label,a,b}]  (or a:{label,points:[…]}, b:{label,points:[…]} for two lists).
  {type:"versus", pos:[0,0,1080,1350], bg:"#0E0B14", accent:"#7C5CFF", title:"iOS vs Android",
    a:{label:"iOS"}, b:{label:"Android"}, rows:[
      {label:"Updates", a:"Day-one, 5+ yrs", b:"Varies by maker"},
      {label:"Customization", a:"Limited", b:"Deep"}]}

RICH BACKGROUNDS — bg_style (works on sections/editorial/stat/event/feature_grid/split/timeline/pricing/versus): the engine composes a
layered, collision-proof background BEHIND the content so you never hand-place decor. Combine
tokens with "+". Pass palette:[…] to color mesh/marble AND to make a gradient multi-hue. Keep
bg as the base canvas color (light bg → keep text dark; dark bg → set text_color light). Tokens:
  base:    gradient (or gradient:vert / gradient:135 / gradient:horiz) · mesh · marble · radial · solid · photo
  sweep:   curve (curved sweep) · glow (spotlight) · band/band_top (accent edge bar) · grain (film noise) · vignette
           curve & glow take a PLACEMENT: curve:tr|tl|br|bl (default tr) · glow:top|bottom|center|left|right (default top)
  texture: any pattern name (dots · grid · graph_paper · halftone · blueprint · carbon · waves · chevron · newsprint · riso · engraving · mezzotint…)
  photo:   base "photo" + bg_image:"https://…" → full-bleed image with an auto legibility scrim (editor/HTML; PNG shows the scrim)
  e.g.  bg_style:"gradient + curve + dots"          (warm editorial)
        bg_style:"mesh + glow + grain"              (premium dark report — pair bg:"#0E0B14", text_color:"#F5F1EA", palette:[…])
        bg_style:"gradient + curve:bl + vignette"   · bg_style:"photo + grain" with bg_image:"https://…"
  Palette colors are auto-tinted toward bg, textures render whisper-faint, sweeps fade to the base — so text stays readable.

## Data-viz + reuse
Chart:     {type:"chart", chart:"bar"|"line"|"area"|"pie"|"donut", pos:[..], data:[{x,y}..]}
           (label/value/name/count also map to x/y; or pass a raw vega-lite spec:{...})
KPI:       {type:"kpi_card", pos:[..], label:"Revenue", value:"$1.2M", delta:"+12%", icon:"dollar-sign", fill:"#16213E"}
Component: {type:"component", pos:[..], ref:"<saved-id>", slots:{...}}  (make one via templates(op:save_component))
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
         PRINT FINISHES (hand-printed grain, best low-opacity over paper):
         newsprint · riso · engraving · mezzotint.
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
- radius: number (uniform) or [tl,tr,br,bl] (per-corner)

Frontier custom composition (you can SEE the render — compose freely, then verify):
- ROTATE any layer with rotate:<deg> (aliases angle / rotation) — tilted stamps,
  kickers, ghost numerals, corner badges. Rotates about the layer's center.
- KEEP an exact custom layout (deliberate overlap, off-canvas bleed, layered depth,
  asymmetry) by wrapping the whole composition in ONE locked group
  {type:"group", locked:true, pos:[0,0,W,H], layers:[…]}. The engine then skips its
  auto-rescue (no reflow / re-light / decollide / recenter) and renders your EXACT
  placement + colors — including intentional overlap and faint ghost tints it would
  otherwise "fix". You own the geometry; render_preview + iterate.
- DATA VIZ on a custom canvas: {type:"chart", chart:"bar"|"donut"|"line", data:[…]}
  rasterizes to native shapes so it shows in PNG/PDF — even nested inside a (locked)
  group. bar/donut want [{label,value}]; line wants [{x,y}]. Color it to match your
  canvas: bar → bar_color/value_color/label_color/track_color; donut → colors:[hex,…]
  (slice palette) + label_color/value_color; line → accent (line+area). Falls back to
  theme tokens. A donut draws arcs + a %-legend; a line draws a polyline + area + dots.
- BLEED a decorative shape (an accent circle, a half-bleed band) off any canvas edge
  freely — it's kept as scenery (not reflowed, not clamped, never a collision floor),
  so it won't shove your content. No locked group needed for a single bleeding accent.
- DIAGRAMS / FLOWCHARTS: join two anchors with a connector — {type:"connector",
  from:[x,y], to:[x,y], arrow:"end"|"both", curve:"straight"|"elbow"|"arc"|"s",
  bend:0-1, stroke:{color,width}}. The engine draws the curve + arrowhead and never
  reflows a connector or its nodes. A LABEL centered inside a node rect stays inside
  it (label-on-shape is preserved, not ejected), so hand-place nodes (rect + centered
  text) at any positions and wire them — no locked group needed for a spaced-out graph.
- A dense DASHBOARD = one locked group holding bg + masthead + stat tiles (rect panel
  + big number + mono label) + a colored chart + a footer rule. Group children carry
  ABSOLUTE coords (the group applies no render transform).`,

  workflow: WORKFLOW_GUIDE,

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

  assets: ASSETS_GUIDE,
  style: STYLE_GUIDE,
};

// Frontier (minimal) instances: prepend a note that reframes the aesthetic
// prescription below as optional scaffolding — the model designs by its own
// judgment; only the SPATIAL guarantees still apply. §0.4.
const MINIMAL_PREAMBLE = `⚡ FREE-COMPOSE MODE — design by YOUR OWN judgment. The aesthetic suggestions below
(flat canvas, no-gradient, specific fonts, ONE accent, left-anchor) are SCAFFOLDING
for smaller models — treat them as optional; your palette, type, color + composition
choices win. What ALWAYS applies: the SPATIAL guarantees — presets measure + fit so
nothing collides; wrap deliberate hand-placement in ONE group or set locked:true to
keep your EXACT layout; act on the returned overflow/contrast notes; default to ONE
design. The engine is your renderer + ruler, not your art director.

`;

export function buildGuide(section?: string): string {
  if (section) {
    // Craft rulebooks live in ./craft (kept out of this file's 700-line budget).
    const c = craft(section);
    if (c) return isMinimalGuidance() ? MINIMAL_PREAMBLE + c : c;
    if (!(section in SECTIONS)) {
      return `Unknown section "${section}". Available: ${[...Object.keys(SECTIONS), ...CRAFT_SECTIONS].join(' | ')}`;
    }
  }
  const body = section ? SECTIONS[section] : SECTIONS['quick_ref'];
  return isMinimalGuidance() ? MINIMAL_PREAMBLE + body : body;
}

export const GUIDE_SECTIONS = [...Object.keys(SECTIONS), ...CRAFT_SECTIONS];
