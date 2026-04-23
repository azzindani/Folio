// Static engine reference returned by get_engine_guide.
// Loaded once per session; gives the model everything it needs to generate
// correct tool calls without guessing field names or shorthand syntax.

export function buildGuide(): string {
  return `# Folio Engine Guide

## Canvas Defaults
1080x1080 (square) · 1080x1350 (portrait) · 1920x1080 (landscape)
Units: px · z = stacking order (higher = front)

## Layer Types & Required Fields
rect    id,type,z,x,y,width,height          + fill?,stroke?,radius?,opacity?
text    id,type,z,x,y,width,content,style   content:{type:"plain",value:"..."} style:{font_size,color,weight?,align?}
image   id,type,z,x,y,width,height,src      src = absolute path or URL
ellipse id,type,z,x,y,width,height          same optional fields as rect
line    id,type,z,x1,y1,x2,y2              + stroke?
group   id,type,z,x,y,width,height,layers[] nested layers array
icon    id,type,z,x,y,width,height,icon     icon = lucide icon name e.g. "star"
component id,type,z,x,y,width,height,ref   ref = component ID

## Shorthand Format (layers_shorthand — PREFERRED for local models)
Use pos:[x,y,w,h] to replace x/y/width/height in one field.
Saves ~80% tokens vs full verbose spec. Always prefer over layers[].

Examples:
  {id:"bg",   type:"rect",  z:0,  pos:[0,0,1080,1080], fill:"#1A1A2E"}
  {id:"hero", type:"image", z:5,  pos:[0,0,1080,540],  src:"/assets/photo.jpg"}
  {id:"h1",   type:"text",  z:10, pos:[80,200,920,120], text:"Hello World", size:72, weight:700, color:"#fff"}
  {id:"sub",  type:"text",  z:11, pos:[80,340,800,60],  text:"Subtitle",    size:24, color:"#aaa"}
  {id:"pill", type:"rect",  z:12, pos:[80,460,200,48],  fill:"#E94560", radius:24}
  {id:"line1",type:"line",  z:3,  x1:80, y1:600, x2:1000, y2:600, stroke:"#333"}

Shorthand text fields: text, size, weight, color, align (replaces content+style objects)
Shorthand fill:  "#hex" | "rgba(r,g,b,a)" | {type:"gradient",angle:135,stops:[{color,pos}]}

## Design Types
poster   Single page. layers[] live at top level. Seal immediately after adding layers.
carousel Multi-page. Each page added via append_page. Seal after all pages done.

## Correct Workflow — Poster
1. create_design(project_path, name, type="poster")
2. add_layers(design_path, layers_shorthand=[...])   ← all layers in ONE call
3. seal_design(design_path)

## Correct Workflow — Multi-page Carousel (128K context / Gemma 4B)
1. create_task(project_path, task_name, brief, pages=[{label,hints},...])
   → response.next_action tells you exactly what to call next
2. append_page(design_path, page_id, label, layers_shorthand=[...], task_path=...)
   → response.next_action.remaining counts pages left; follow it until remaining==0
3. seal_design(design_path)   ← called automatically when next_action.tool=="seal_design"

## next_action Protocol
Every write-tool response includes next_action:{tool,params,remaining,hint}.
ALWAYS read next_action and call it as your next tool call.
remaining==0 means the sequence is complete — no more calls needed.
If context resets mid-carousel: call resume_task(task_path) to recover.

## Common Mistakes to Avoid
✗ Never return full YAML content back to the user — just call the next tool
✗ Never skip layers_shorthand in favour of verbose layers[] — it wastes tokens
✗ Never call seal_design before all carousel pages are appended
✗ Never omit task_path in append_page when working on a task — breaks handover
✗ layer id must be unique within a design — use descriptive slugs: "bg","hero","title-1"

## Token Budget (Gemma 4B, 128K context)
Each layers_shorthand layer ≈ 15 tokens. A 5-layer page ≈ 75 tokens output.
Aim for 3-6 layers per append_page call. Call add_layers for posters.
inspect_design to check state (returns IDs only, not content — very small).
list_tasks to find task files if task_path is unknown.`;
}
