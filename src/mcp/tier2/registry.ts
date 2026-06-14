// §7 Tier 2 — Medium (9 tools): design lifecycle & layer manipulation
import type { ToolDefinition } from '../types';

export const TIER2_TOOLS: ToolDefinition[] = [
  {
    name: 'inspect_design',
    description: 'Read a design\'s structure (layer IDs, types, z-order, positions) cheaply. Use to verify state before seal_design, or to find a layer_id for update_layer/remove_layer/patch_design. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml (relative ok with project_path)' },
        page_id:      { type: 'string', description: 'Page ID (carousel only; omit to list pages)' },
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
  {
    name: 'add_layers',
    description: 'Compose a poster (or one carousel page) in one call via layers_shorthand. Design like a human, not an AI template: flat solid canvas (warm #FAF5EC or near-black #0A0A0A — NO gradient by default), a headline 4–5× the body in a real display font (set font:"Playfair Display"/"Anton"/etc.), ONE accent used 1–2×, asymmetric left-anchor + whitespace, depth via a 2–4px rule not glows. ALWAYS PREFER A PRESET over hand-placing — almost every poster fits one, and the preset measures + lays out everything so nothing collides. Pick by intent: (1) EVENT / ANNOUNCEMENT / FLYER / "a poster for [a night, sale, launch, party, show, class, fair, fundraiser]" → ONE event layer {type:"event", kicker, title, details:["Sat July 18 · 8 PM","City Park","Free · All ages · Bring a blanket"], footer} — engine centers the title, stacks the date/venue/meta cleanly, sizes to fit. (2) FEATURE / BENEFIT / "CARDS" → ONE feature_grid layer {type:"feature_grid", title, subtitle, items:[{icon,title,desc}]} — evenly-spaced cards; NEVER hand-place card coords (the #1 small-model failure: they pile up illegibly). (3) INFOGRAPHIC / EXPLAINER / "by the numbers" / multiple stats+sections → ONE sections layer {type:"sections", kicker, title, subtitle, blocks:[{kind:"stats",items:[{value,label}]},{kind:"heading_text",heading,body},{kind:"callout",text}]} — engine flows + measures every block. (4) ESSAY / OPINION / EDITORIAL (headline + standfirst + paragraph) → ONE editorial layer {type:"editorial", kicker, title, subtitle, body, footer}. Omit bg/accent to let the engine pick a topic-apt look. When the user asks for SEVERAL OPTIONS of one topic, make them genuinely different: vary the PRESET across options (e.g. one event, one feature_grid, one sections) AND the palette — three of the same preset in different colors read as one design, not three. Icon names can be plain emoji (🥕 ☕ 📍) — the engine maps them to real glyphs. Hand-place 3–8 layers (pos:[x,y,w,h]) ONLY for a layout no preset fits; then EVERY sized layer needs width+height (or it renders invisible), include a full-canvas bg rect, and NEVER stack two text layers in the same area (they overprint into an unreadable smear) and NEVER leave an empty rect as a placeholder (it renders as a meaningless box). Returns a clickable open_url. → then seal_design.',
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
      },
      required: ['project_path', 'name'],
    },
  },
  {
    name: 'append_page',
    description: 'Add ONE page to a carousel — raw layers_shorthand, or template_ref+slots. Pass task_path to enable auto-handover. Repeat until next_action.remaining==0, then seal_design. Returns an open_url that opens to the new page.',
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
      },
      required: ['design_path'],
    },
  },
  {
    name: 'patch_design',
    description: 'Edit a SEALED design via dot-path selectors (e.g. layers[3].style.color). Run dry_run=true first to validate paths, then apply, then seal_design again. Snapshots before write.',
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
    description: 'Finalize a design (poster: after add_layers; carousel: after the last append_page). Returns the editor open_url. → next_action is export_design; you can also open_in_editor. Edit a sealed design only via patch_design.',
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
    name: 'add_layer',
    description: 'Add ONE layer. Prefer add_layers (plural) to add several at once — fewer round-trips. Sized layers need width+height.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        page_id:      { type: 'string', description: 'Page ID (carousel only)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        layer:        { type: 'object', description: 'Layer specification', properties: {} },
      },
      required: ['design_path', 'layer'],
    },
  },
  {
    name: 'update_layer',
    description: 'Merge props into a layer by ID. Snapshots before write. CAROUSEL: pass page_id to scope the edit to one page — carousel pages share layer IDs (sections_1 etc.), so without it every page with that ID is patched.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_id:     { type: 'string', description: 'Layer ID to update' },
        page_id:      { type: 'string', description: 'Carousel: restrict the update to this page (recommended — IDs repeat across pages)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        props:        { type: 'object', description: 'Properties to merge', properties: {} },
      },
      required: ['design_path', 'layer_id', 'props'],
    },
  },
  {
    name: 'remove_layer',
    description: 'Remove a layer by ID. CAROUSEL: pass page_id to scope removal to one page — pages share layer IDs (sections_1 etc.), so WITHOUT page_id the same ID is removed from EVERY page (this silently empties sibling slides).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_id:     { type: 'string', description: 'Layer ID to remove' },
        page_id:      { type: 'string', description: 'Carousel: restrict removal to this page (recommended — IDs repeat across pages)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'layer_id'],
    },
  },
];
