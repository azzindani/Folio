// §7 Tier 2 — Compose (7 tools): design lifecycle, layer composition + editing,
// reference matching. (edit_layer folds add/update/remove/align onto an `op`
// discriminator; the create/add/patch/seal/append/reference tools are unchanged.)
import type { ToolDefinition } from '../types';
import { isMinimalGuidance, freeComposeDescription } from '../guidance-mode';

export const TIER2_TOOLS: ToolDefinition[] = [
  {
    name: 'create_design',
    description: 'Create a new design and get a clickable editor open_url (unique token) to view it immediately. type="poster" = single page → next_action is add_layers. type="carousel" = multi-page → next_action is append_page (repeat per page). theme_ref sets the palette+fonts; for a human, art-directed look pick a flat-canvas theme that fits the topic — "editorial-cream"/"gallery" (warm/minimal serif), "bold-poster" (near-black + vermillion), "swiss-international" (paper + red/blue), "mono-print"/"brutalist-mono" — rather than a dark glowy tech theme. Always follow the returned next_action.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Project name (bare, e.g. "ai-poster") or path to the project dir. A bare name is placed in the projects dir automatically — do not build absolute /home/... paths.' },
        name:         { type: 'string', description: 'Design name' },
        type:         { type: 'string', enum: ['poster', 'carousel'], default: 'poster' },
        width:        { type: 'number', description: 'Canvas width px', default: 1080 },
        height:       { type: 'number', description: 'Canvas height px', default: 1080 },
        theme_ref:    { type: 'string', description: 'Theme reference ID' },
        style_seed:   { type: 'string', description: 'Optional label recorded ON the design for the departure it was made under — pass the same style_seed you gave manage_design {op:"style_history"}. It changes nothing about how this design renders; it is what later lets style_history check whether designs made under different seeds actually came out different, instead of taking the seed\'s word for it.' },
      },
      required: ['project_path', 'name'],
    },
  },
  {
    name: 'add_layers',
    description: 'Compose a poster (or one carousel page) in one call via layers_shorthand. Design like a human, not an AI template: flat solid canvas (warm #FAF5EC or near-black #0A0A0A — NO gradient by default), a headline 4–5× the body in a real display font (set font:"Playfair Display"/"Anton"/etc. On a LANDSCAPE canvas (16:9 slide) presets overflow — they are portrait-first — so wrap them in {type:"columns", pos:[0,0,W,H], cols:[…]}: each child gets a full-height column, which is the portrait box presets are built for. See get_engine_guide {section:"shorthand"}.), ONE accent used 1–2×, asymmetric left-anchor + whitespace, depth via a 2–4px rule not glows. ALWAYS PREFER A PRESET over hand-placing — almost every poster fits one, and the preset measures + lays out everything so nothing collides. Pick by intent: (1) EVENT / ANNOUNCEMENT / FLYER / "a poster for [a night, sale, launch, party, show, class, fair, fundraiser]" → ONE event layer {type:"event", kicker, title, details:["Sat July 18 · 8 PM","City Park","Free · All ages · Bring a blanket"], footer} — engine centers the title, stacks the date/venue/meta cleanly, sizes to fit. (2) FEATURE / BENEFIT / "CARDS" → ONE feature_grid layer {type:"feature_grid", title, subtitle, items:[{icon,title,desc}]} — evenly-spaced cards; NEVER hand-place card coords (the #1 small-model failure: they pile up illegibly). Set layout:"rows" (full-width editorial rows: marker left, copy right) OR "cards" (tiled grid) and VARY it so two feature posters do not share a silhouette. feature_grid is ONLY for feature/benefit cards — for a comparison, timeline or pricing use the matching preset below, NOT a card grid. (3) INFOGRAPHIC / EXPLAINER / "by the numbers" / multiple stats+sections → ONE sections layer {type:"sections", kicker, title, subtitle, blocks:[{kind:"stats",items:[{value,label}]},{kind:"heading_text",heading,body},{kind:"callout",text}]} — engine flows + measures every block. DATA VIZ blocks (all rasterize): {kind:"bars",items:[{label,value}]} for a ranking, {kind:"donut",items:[{label,value}]} for a share/breakdown (parts of a whole), {kind:"line",items:[{x,y}]} for a trend over time — add the one the data calls for instead of leaving numbers as plain text. (4) ESSAY / OPINION / EDITORIAL (headline + standfirst + paragraph) → ONE editorial layer {type:"editorial", kicker, title, subtitle, body, footer}. (5) PROCESS / FLOW / WORKFLOW / "how X moves/works" / lifecycle / journey (SEQUENTIAL steps) → ONE sections layer whose blocks include a flow block {kind:"flow", items:[{title, desc}]} — the engine draws numbered nodes connected by arrows, measured so steps NEVER collide; NEVER hand-place circles/boxes/arrows for a flow (they overlap into an unreadable pile). (6) COMPARISON / "X vs Y" / which-is-better → ONE versus layer {type:"versus", title, a:{label}, b:{label}, rows:[{label, a, b}]} — a true split with a VS medallion + per-aspect rows either side of a center divider (inside a bigger report, a {kind:"versus"} sections block instead); NEVER use feature_grid or hand-place a comparison (a card grid hides the head-to-head). (7) TIMELINE / HISTORY / ROADMAP / milestones over time → ONE timeline layer {type:"timeline", title, items:[{date, title, desc}]} — a connected spine of node dots with each date heroed in the accent (inside a report, a {kind:"timeline"} sections block); NEVER use feature_grid (a row of cards throws the chronology away). (8) PRICING / PLANS / TIERS → ONE pricing layer {type:"pricing", title, plans:[{name, price, period, features:[...], featured}]} — tier columns with the featured tier lifted + a "MOST POPULAR" ribbon + a checked feature list (inside a report, a {kind:"pricing"} sections block); NEVER use feature_grid (it loses the price hierarchy + featured emphasis). Omit bg/accent to let the engine pick a topic-apt look. Default to EXACTLY ONE design and stop — do NOT volunteer extra options/variations (generating several unasked wastes time + tokens). ONLY when the user EXPLICITLY asks for SEVERAL OPTIONS/variations/versions, make exactly the number requested, and each option MUST use a DIFFERENT preset (e.g. option 1 = event, option 2 = feature_grid, option 3 = editorial) AND a different palette — the SAME layout recolored, or three hand-placed title/detail/footer posters, is the #1 "looks like a template, not unique" failure. Different preset = different structure = a genuinely different design. Icon names can be plain emoji (🥕 ☕ 📍) — the engine maps them to real glyphs. Hand-place 3–8 layers (pos:[x,y,w,h]) ONLY for a layout NO preset fits — a kicker + headline + a few date/venue/detail lines + a footer IS an event preset (or editorial), so use that; hand-placing it as loose text layers gives dead space, a templated look, and invisible text. When you genuinely must hand-place: EVERY sized layer needs width+height (or it renders invisible), set an explicit color on EVERY text layer (an uncolored layer renders black → invisible on a dark background), include a full-canvas bg rect, NEVER stack two text layers in the same area (they overprint into an unreadable smear), and NEVER leave an empty rect/shape as a placeholder (a meaningless box). To keep a DELIBERATE composition EXACTLY as you placed it (intentional overlap, off-canvas bleed, a tight stamp/badge, a precise band), wrap your primitives in ONE group {type:"group", x:0, y:0, width:<W>, height:<H>, layers:[…]} OR set locked:true on the layer/group — the engine then PRESERVES your placement + colors instead of reflowing, re-measuring or re-lighting them (loose un-grouped hand-placed layers are otherwise treated as mistakes to rescue, so the engine may move or recolor them). To FILL a large empty area beside a left-anchored column (the usual dead space), add ONE decorative MOTIF — {type:"motif", motif:"bolt|arcs|waves|orbit|rays|grid|peaks|circuit", pos:[x,y,w,h], color:"<accent>"} — a composed vector illustration the engine draws from primitives (rasterizes, token-safe); pick one that fits the topic (bolt=energy/storm, waves=fluid/audio, orbit=science/network, peaks=growth/outdoors, circuit=tech, arcs/rays/grid=abstract) and size it to occupy the empty region — far better than a half-blank canvas. Returns a clickable open_url. → then seal_design.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:      { type: 'string', description: 'Path to .design.yaml' },
        page_id:          { type: 'string', description: 'Page ID (carousel only)' },
        project_path:     { type: 'string', description: 'Project dir — enables relative design_path' },
        layers:           { type: 'array', description: 'Verbose layers array', items: { type: 'object' } },
        layers_shorthand: { type: 'array', description: 'Compact shorthand — 80% fewer tokens', items: { type: 'object' } },
        task_path:        { type: 'string', description: 'Path to .task.yaml — enables handover baton' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'edit_layer',
    description: 'Edit individual layers on a sealed/in-progress design — pick `op` (for BULK composition use add_layers instead):\n• add — add ONE layer (req: design_path, layer). Sized layers need width+height.\n• update — merge props into a layer by ID (req: design_path, layer_id, props). Snapshots before write.\n• remove — delete a layer by ID (req: design_path, layer_id).\n• align — auto-align/distribute/snap a set of layers, the fix for diagnose_design misalignment (req: design_path, layer_ids, operation = left|right|top|bottom|center_h|center_v|distribute_h|distribute_v|snap_grid).\n• patch_spec — change a PRESET by editing the spec that built it, then re-render it in place (req: design_path, layer_id, changes). A preset group is ~30 generated layers; patching the intent (\"three blocks not five\", a new accent, a different headline_style) is one call instead of thirty edits or a rebuild. Objects merge key by key, ARRAYS replace wholesale, null DELETES a field. Read the current spec first with manage_design {op:\"get_spec\"}; pass dry_run:true to see the diff without writing.\nCAROUSEL: pages share layer IDs (sections_1 etc.) — pass page_id to scope update/remove/align to ONE page, or every page with that ID is hit.',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['add', 'update', 'remove', 'align', 'patch_spec', 'shape'], description: 'Which layer edit to run.' },
        design_path:  { type: 'string', description: 'Path to .design.yaml.' },
        page_id:      { type: 'string', description: 'Carousel: scope the edit to one page (IDs repeat across pages).' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path.' },
        layer:        { type: 'object', description: 'op:add — the layer specification.', properties: {} },
        layer_id:     { type: 'string', description: 'op:update/remove/patch_spec — the layer ID.' },
        shape_op:     { type: 'string', enum: ['offset', 'outline_stroke', 'blend'], description: 'op:shape — which path operation. offset grows (+delta) or shrinks (−delta) a closed shape. outline_stroke turns a stroke into a filled shape covering the same ink, so it scales as artwork instead of as a line. blend makes the in-between shapes between TWO paths (Illustrator\'s Blend). All three take `path` layers and produce new `path` layers, which render identically in the editor, resvg exports and PDF.' },
        delta:        { type: 'number', description: 'op:shape/offset — px to grow (positive) or shrink (negative).' },
        steps:        { type: 'number', description: 'op:shape/blend — how many in-between shapes (1-24, default 3). The two originals are left as they are; a blend is the shapes BETWEEN them.' },
        keep_source:  { type: 'boolean', description: 'op:shape — keep the layer operated on (default true). Ignored for blend, which never consumes its endpoints.', default: true },
        props:        { type: 'object', description: 'op:update — properties to merge.', properties: {} },
        layer_ids:    { type: 'array', description: 'op:align — layer IDs to align.', items: { type: 'string' } },
        operation:    { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'center_h', 'center_v', 'distribute_h', 'distribute_v', 'snap_grid'], description: 'op:align — alignment operation (distribute_* needs ≥3 layers).' },
        grid:         { type: 'number', description: 'op:align — grid size px for snap_grid (default 8).' },
        changes:      { type: 'object', description: 'op:patch_spec — spec fields to merge into the preset\'s authored spec. Only what you want different: {accent:"#0EA5E9"} keeps every other field. Objects merge, arrays replace, null deletes.', properties: {} },
        dry_run:      { type: 'boolean', description: 'op:patch_spec — return the changed keys and resulting layer count without writing.' },
      },
      required: ['op', 'design_path'],
    },
  },
  {
    name: 'append_page',
    description: 'Add ONE page to a carousel — raw layers_shorthand, or template_ref+slots. Pass task_path to enable auto-handover. Repeat until next_action.remaining==0, then seal_design. COHESION — a carousel is ONE design, not N standalone posters: pick ONE palette (same bg + same accent) and ONE heading font UP FRONT and pass them IDENTICALLY on every page. Do NOT re-theme a slide to its content (a "steep overnight" slide going dark while the rest are cream is the #1 carousel failure — it reads like seven different designers). Vary the WORDS per slide, never the canvas. Returns an open_url that opens to the new page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:      { type: 'string', description: 'Path to .design.yaml' },
        page_id:          { type: 'string', description: 'Page identifier' },
        label:            { type: 'string', description: 'Page label' },
        project_path:     { type: 'string', description: 'Project dir — enables relative design_path' },
        template_ref:     { type: 'string', description: 'Template ID to use' },
        slots:            { type: 'object', description: 'Slot values for the template', properties: {} },
        layers:           { type: 'array', description: 'Verbose layers array', items: { type: 'object' } },
        layers_shorthand: { type: 'array', description: 'Compact shorthand — 80% fewer tokens', items: { type: 'object' } },
        task_path:        { type: 'string', description: 'Path to .task.yaml — enables handover baton' },
        replace:          { type: 'boolean', description: 'With an EXISTING page_id: overwrite that page IN PLACE (order + other pages untouched) instead of renaming to page_id-2. The way to fix one deck page without rebuilding.' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'patch_design',
    description: 'Edit a SEALED design via dot-path selectors (e.g. layers[3].style.color). Run dry_run=true first to validate paths, then apply, then seal_design again. Snapshots before write. RESTYLE/RECOLOR a whole design in ONE selector with {path:"recolor", value:{"#OLDHEX":"#NEWHEX", …}} — it swaps every matching color (bg, text, accents) across all layers. Use this to "make it darker"/flip the palette: manage_design(op:inspect) or read the design to get its actual hexes, then map each to the new shade (themes(op:apply) does NOT recolor a design — it only sets the project default, and most designs use baked-in hexes).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        dry_run:      { type: 'boolean', description: 'Validate selectors without writing (default false)', default: false },
        selectors: {
          type: 'object',
          description: 'Array of {path, value} selectors',
          items: { type: 'object', properties: { path: { type: 'string' }, value: { type: 'string' } } },
        },
      },
      required: ['design_path', 'selectors'],
    },
  },
  {
    name: 'seal_design',
    description: 'Finalize a design (poster: after add_layers; carousel: after the last append_page). Returns the editor open_url. → next_action is export_design; you can also open_in_editor. Edit a sealed design only via patch_design / edit_layer.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'extract_reference',
    description: 'Turn a REFERENCE design (a Canva export, screenshot, or SVG the user wants to match) into a deterministic palette + recommended canvas + a step-by-step composition brief. You (the model) already SEE the image — this tool supplies what you guess badly: exact pixel dimensions and a role-mapped palette (background/surface/text/accent/secondary/border). Call it FIRST when the user says "make it like this", "match this design", or attaches a reference. Pass colors:[…] = the main hex you observe in the image, and/or image = a data: URL or a local file path (https URLs are not fetched — send observed colors instead). Returns palette_spec + a brief; then create_design at the recommended canvas and add_layers using the EXACT hex, reproducing the reference layout (do NOT fall back to a centered navy-gradient template).',
    inputSchema: {
      type: 'object',
      properties: {
        colors:       { type: 'array', description: 'Array of the main hex colors you observe in the reference, e.g. ["#0A0A0A","#FF3D00","#FAFAFA"] — most reliable input', items: { type: 'string' } },
        image:        { type: 'string', description: 'Optional: a data: URL (data:image/png;base64,… or data:image/svg+xml,…) or a local file path. Used for EXACT dimensions + (SVG) exact colors. Remote http(s) URLs are not fetched.' },
        project_path: { type: 'string', description: 'Optional project name — when given, next_action points straight at create_design' },
        name:         { type: 'string', description: 'Optional name for the design/palette derived from this reference' },
      },
    },
  },
];

// Frontier instances (FOLIO_GUIDANCE=minimal) drop the prescriptive aesthetic lead
// from add_layers so the model's own design judgment isn't capped (§0.4). Default
// (full) is untouched — the description is byte-identical for the blind-model path.
if (isMinimalGuidance()) {
  const addLayers = TIER2_TOOLS.find(t => t.name === 'add_layers');
  if (addLayers) addLayers.description = freeComposeDescription(addLayers.description, true);
}
