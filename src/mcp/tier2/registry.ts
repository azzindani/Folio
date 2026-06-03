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
    name: 'add_layers',
    description: 'Compose a poster (or one carousel page) in one call via layers_shorthand. Design like a human, not an AI template: flat solid canvas (warm #FAF5EC or near-black #0A0A0A — NO gradient by default), a headline 4–5× the body in a real display font (set font:"Playfair Display"/"Anton"/etc.), ONE accent used 1–2×, asymmetric left-anchor + whitespace, depth via a 2–4px rule not glows, radius 0 or pill. FEATURE / BENEFIT / "CARDS" POSTER? Send ONE feature_grid layer — {type:"feature_grid", title, subtitle, bg:"#0A0A0A", accent:"#FF3D00", items:[{icon,title,desc}]} — the engine lays out the background, title and evenly-spaced cards; do NOT hand-place card coordinates (they collide into an illegible pile — the #1 small-model failure). For text posters use 3–8 hand-placed layers (pos:[x,y,w,h]); always include a full-canvas background rect, and every sized layer needs width+height or it renders invisibly. Returns a clickable open_url. → then seal_design.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:      { type: 'string', description: 'Path to .design.yaml' },
        page_id:          { type: 'string', description: 'Page ID (carousel only)' },
        project_path:     { type: 'string', description: 'Project dir — enables relative design_path' },
        layers:           { type: 'object', description: 'Verbose layers array', items: { type: 'object' } },
        layers_shorthand: { type: 'object', description: 'Compact shorthand — 80% fewer tokens', items: { type: 'object' } },
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
        layers:           { type: 'object', description: 'Verbose layers array', items: { type: 'object' } },
        layers_shorthand: { type: 'object', description: 'Compact shorthand — 80% fewer tokens', items: { type: 'object' } },
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
    description: 'Merge props into a layer by ID. Snapshots before write.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_id:     { type: 'string', description: 'Layer ID to update' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        props:        { type: 'object', description: 'Properties to merge', properties: {} },
      },
      required: ['design_path', 'layer_id', 'props'],
    },
  },
  {
    name: 'remove_layer',
    description: 'Remove a layer by ID from design or all pages.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_id:     { type: 'string', description: 'Layer ID to remove' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'layer_id'],
    },
  },
];
