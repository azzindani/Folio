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

## Writing them
  patch_design {path:"names", value:{…}}
  patch_design {path:"layers[id=card].formulas", value:{width:"=Col"}}
  (a page: pages[id=p2].names / pages[id=p2].layers[id=card].formulas)
Change the name once → every layer reading it follows.

## When one fails
It is NOT applied — the property keeps its literal value — and diagnose_design
reports formula_error naming the layer, the property and the reason.
`;
