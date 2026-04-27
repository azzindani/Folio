// Engine reference guide — split into sections to stay within 1K output budget.
// Default section (quick_ref) ≈200 tokens. Full guide = 4 calls ≈800 tokens total.

const SECTIONS: Record<string, string> = {

  quick_ref: `# Folio Quick Ref
Canvas: 1080x1080 (sq) · 1080x1350 (port) · 1920x1080 (land) · units: px
Design types: poster (single page) | carousel (multi-page)
z = stacking order (higher = front)

Poster workflow:
  1. create_design(project_path, name, type="poster")
  2. add_layers(design_path, layers_shorthand=[...])
  3. seal_design(design_path)

Carousel workflow:
  1. create_task(project_path, task_name, brief, pages=[{label,hints}])
  2. append_page(design_path, page_id, layers_shorthand=[...], task_path=...)
     → repeat until next_action.remaining==0
  3. seal_design(design_path)

Rules:
  - Always use layers_shorthand — saves 80% tokens vs verbose layers[]
  - Always pass task_path in append_page — enables auto-handover
  - Call resume_task(task_path) after any context reset
  - 3–6 layers per page is ideal for local models
  - Load guide sections on demand: shorthand | layers | workflow`,

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

Text shorthand fields:  text, size, weight, color, align, text_decoration:"underline"|"line-through"
Fill shorthand:         "#hex" | "rgba(r,g,b,a)" | {type:"gradient",angle:135,stops:[{color,pos}]}
Stroke shorthand:       "#hex" or {color:"#hex",width:2,dash:[4,2]}
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
