// §7 Tier 3 — Advanced (6 tools): export, batch, templates, components
import type { ToolDefinition } from '../types';

export const TIER3_TOOLS: ToolDefinition[] = [
  {
    name: 'open_in_editor',
    description: 'Return a clickable, token-embedded URL that opens a design in the Folio editor (live-refreshes as later tools edit the file). NOTE: create_design/append_page/seal_design/export_design already return this as open_url — only call this to re-open, focus a page, or open the editor home.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string',  description: 'Path to .design.yaml — omit to open the editor at its home page' },
        project_path: { type: 'string',  description: 'Project dir for resolving relative design_path' },
        editor_url:   { type: 'string',  description: 'Override editor base URL (default: $FOLIO_EDITOR_URL or http://localhost:4173)' },
        page:         { type: 'number',  description: 'Page index to focus (1-based)' },
      },
      required: [],
    },
  },
  {
    name: 'export_design',
    description: 'Export a design to SVG, PNG or HTML (all produce real files). A carousel exports one file per page (`<name>-p1.svg`, `-p2.svg`, …); output_paths lists them. pdf stages an HTML for Puppeteer and returns success:false.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        // svg/png/html produce real files; a carousel yields one file per page.
        // pdf returns success:false with the staged-HTML path so the caller can
        // run the Puppeteer step. Keep all in the enum for discoverability.
        format:       { type: 'string', enum: ['svg', 'html', 'pdf', 'png'] },
        output_path:  { type: 'string', description: 'Output path (auto-derived if omitted)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        scale:        { type: 'number', description: 'Scale factor 1–3', default: 2 },
      },
      required: ['design_path', 'format'],
    },
  },
  {
    name: 'export_library_gallery',
    description: 'Build a self-contained HTML "file manager" for the WHOLE design library — every project and design as a thumbnail card with a live search box and click-through to open each in the editor. Writes <projects>/library.html plus cached thumbnails (re-runs only re-render changed designs). Open the file in a browser to browse everything you\'ve made. Optionally filter with `search`/`type`, or cap first-build rendering with `max_thumbnails`.',
    inputSchema: {
      type: 'object',
      properties: {
        output_path:    { type: 'string', description: 'Where to write the gallery HTML (default <projects>/library.html)' },
        max_thumbnails: { type: 'number', description: 'Max NEW thumbnails to render this call (default 120; cached ones are free). Re-run to fill the rest.' },
        search:         { type: 'string', description: 'Only include designs/projects matching this substring' },
        type:           { type: 'string', description: 'Only include designs of this type' },
      },
    },
  },
  {
    name: 'diagnose_design',
    description: 'Built-in troubleshooter — scans a design for problems the model is blind to and returns structured findings with fixes: off-canvas layers, collisions/overlap pile-ups, near-miss MISALIGNMENT (edges off by a few px), tiny text, low-contrast/invisible text, missing background, plus quality critique (weak hierarchy, accent sprawl, crowded margins). Run it after composing and before seal_design; fix the errors/warnings, then render_preview to confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        page_id:      { type: 'string', description: 'Carousel: diagnose one page (omit = all pages)' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'render_preview',
    description: 'Render the design to a PNG and return it INLINE as an image so you can SEE what you produced (no file written). Use it to visually verify a composition or confirm a fix — pair with diagnose_design. Foreground charts/KPIs that need a browser still only appear in the editor; everything else (shapes, patterns, text, fills) rasterizes here.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        page_id:      { type: 'string', description: 'Carousel: preview one page (omit = first page)' },
        scale:        { type: 'number', description: 'Raster scale 0.5–2 (default 1)', default: 1 },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'align_layers',
    description: 'Auto-align / distribute / snap-to-grid a set of layers — the fix for diagnose_design misalignment findings. operation: left|right|top|bottom|center_h|center_v (align edges/centers across the group), distribute_h|distribute_v (even spacing, needs ≥3), snap_grid (round each to the grid). Mutates positions and writes the YAML (with a backup).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_ids:    { type: 'array', description: 'Layer IDs to align', items: { type: 'string' } },
        operation:    { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'center_h', 'center_v', 'distribute_h', 'distribute_v', 'snap_grid'] },
        grid:         { type: 'number', description: 'Grid size px for snap_grid (default 8)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        page_id:      { type: 'string', description: 'Carousel page id (omit = first page)' },
      },
      required: ['design_path', 'layer_ids', 'operation'],
    },
  },
  {
    name: 'batch_create',
    description: 'Generate N designs from one template using an array of slot objects.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        template_id:  { type: 'string', description: 'Template ID to use' },
        slots_array:  { type: 'array', description: 'One slot object per design', items: { type: 'object' } },
      },
      required: ['project_path', 'template_id', 'slots_array'],
    },
  },
  {
    name: 'save_as_component',
    description: 'Extract layers into .component.yaml and replace with component instance.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:    { type: 'string', description: 'Path to source .design.yaml' },
        layer_ids:      { type: 'array', description: 'Layer IDs to extract', items: { type: 'string' } },
        component_name: { type: 'string', description: 'Name for the new component' },
        project_path:   { type: 'string', description: 'Path to project directory' },
      },
      required: ['design_path', 'layer_ids', 'component_name', 'project_path'],
    },
  },
  {
    name: 'export_template',
    description: 'Export design as .template.yaml skeleton with named slots.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to source .design.yaml' },
        output_path:  { type: 'string', description: 'Output path for .template.yaml (auto if omitted)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'inject_template',
    description: 'Inject slot values into template to produce a .design.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        template_path: { type: 'string', description: 'Path to .template.yaml' },
        slots:         { type: 'object', description: 'Map of slot_id → value', properties: {} },
        output_path:   { type: 'string', description: 'Output path for .design.yaml (auto if omitted)' },
      },
      required: ['template_path', 'slots'],
    },
  },
  {
    name: 'list_template_slots',
    description: 'List injectable slots in a .template.yaml with paths, types, hints.',
    inputSchema: {
      type: 'object',
      properties: { template_path: { type: 'string', description: 'Path to .template.yaml' } },
      required: ['template_path'],
    },
  },
  // ── Report tools ──────────────────────────────────────────
  {
    name: 'generate_report',
    description: 'Scaffold a new report-type design with pages, navigation, and optional data sources. Use layout:"flow" for a responsive interactive dashboard/report (12-col grid, layers placed by a span field, no fixed canvas) — set accent + font_heading/font_body for an editorial look.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path:  { type: 'string', description: 'Path to project directory' },
        name:          { type: 'string', description: 'Report name' },
        layout:        { type: 'string', enum: ['paged', 'scroll', 'tabs', 'sidebar', 'flow'], default: 'paged', description: 'flow = responsive 12-col grid (span-based, no fixed canvas) — best for interactive HTML reports' },
        nav_type:      { type: 'string', enum: ['sidebar', 'topbar', 'tabs', 'dots'], default: 'sidebar' },
        pages:         { type: 'array', description: 'Array of {id?, label} page specs', items: { type: 'object' } },
        width:         { type: 'number', default: 1080 },
        height:        { type: 'number', default: 1080 },
        data_sources:  { type: 'array', description: 'Optional inline/json/csv data sources', items: { type: 'object' } },
        max_width:     { type: 'number', description: 'Flow reports: centered container max width in px (default 1200)' },
        accent:        { type: 'string', description: 'Flow reports: accent color (CSS) — seeds chart palette + links + active states' },
        font_heading:  { type: 'string', description: 'Flow reports: heading font family (Google font name, e.g. "Playfair Display")' },
        font_body:     { type: 'string', description: 'Flow reports: body font family (Google font name, e.g. "Inter")' },
      },
      required: ['project_path', 'name', 'pages'],
    },
  },
  {
    name: 'bind_data',
    description: 'Attach or update inline datasets on a report design for $data.* / $agg.* expressions.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        datasets:     { type: 'array', description: 'Array of {id, rows[]}', items: { type: 'object' } },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'datasets'],
    },
  },
  {
    name: 'export_report',
    description: 'Assemble a report design into a self-contained interactive HTML file. Returns view_url — a tokenized link that renders the FINAL interactive report directly in a browser. Give the user view_url (the real result), not the editor link; edit_url is also returned for editing the source.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml (must be type: report)' },
        output_path:  { type: 'string', description: 'Output .html path (auto-derived if omitted)' },
        theme:        { type: 'string', enum: ['light', 'dark'], default: 'dark' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'validate_report',
    description: 'Lint an interactive report\'s cross-references BEFORE exporting: every chart/table/filter resolves to a real dataset + field, buttons open existing modals, transforms group by present fields. Returns {ok, errors, warnings, diagnostics[]}. Call after add_layers to catch silent breakage.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml (must be type: report)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  // ── Presentation tools ────────────────────────────────────
  {
    name: 'create_presentation',
    description: 'Scaffold a presentation-type design (1920×1080) with slides, transitions, and presentation settings.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path:  { type: 'string', description: 'Path to project directory' },
        name:          { type: 'string', description: 'Presentation name' },
        pages:         { type: 'array', description: 'Array of {id?, label, notes?} slide specs', items: { type: 'object' } },
        transition:    { type: 'string', enum: ['none','fade','slide-left','slide-right','slide-up','slide-down','zoom-in','zoom-out','flip-h','flip-v','cube-left','cube-right','reveal','wipe-left','wipe-right','dissolve','morph'], default: 'fade' },
        auto_advance:  { type: 'number', description: 'Auto-advance delay ms (0 = manual)' },
        width:         { type: 'number', default: 1920 },
        height:        { type: 'number', default: 1080 },
        theme:         { type: 'string', enum: ['dark', 'light'], default: 'dark' },
      },
      required: ['project_path', 'name', 'pages'],
    },
  },
  {
    name: 'export_presentation',
    description: 'Assemble a presentation/carousel/motion design into a self-contained HTML presenter with transitions, keyboard nav, and audio.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:   { type: 'string', description: 'Path to .design.yaml (must be type: presentation/carousel/motion)' },
        output_path:   { type: 'string', description: 'Output .html path (auto-derived if omitted)' },
        theme:         { type: 'string', enum: ['light', 'dark'], default: 'dark' },
        auto_advance:  { type: 'number', description: 'Override auto-advance delay ms' },
        project_path:  { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  // ── Formula tools ─────────────────────────────────────────
  {
    name: 'set_formula_context',
    description: 'Store state/data context for formula binding on a design. Used by export tools to resolve =expr bindings.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        state:        { type: 'object', description: 'Key-value state variables', properties: {} },
        data:         { type: 'object', description: 'Dataset key-value map', properties: {} },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'debug_formula',
    description: 'Evaluate a formula expression against a given context and return the result with type info.',
    inputSchema: {
      type: 'object',
      properties: {
        formula:      { type: 'string', description: 'Formula string starting with =' },
        state:        { type: 'object', description: 'State variables', properties: {} },
        data:         { type: 'object', description: 'Data variables', properties: {} },
        design_path:  { type: 'string', description: 'Optional: load context from .formula.json' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['formula'],
    },
  },
  {
    name: 'inspect_timeline',
    description: 'Show animation keyframe tracks for a design as ASCII timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        page_id:      { type: 'string', description: 'Optional page filter' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'add_keyframe',
    description: 'Add or replace a keyframe on a layer animation timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        layer_id:     { type: 'string', description: 'Target layer id' },
        keyframe:     { type: 'object', description: '{t:ms, x?, y?, opacity?, scale?, rotation?}', properties: {} },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'layer_id', 'keyframe'],
    },
  },
  {
    name: 'export_animation',
    description: 'Export a presentation design as GIF, MP4, or WebM animation (requires Puppeteer + optionally ffmpeg).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        type:         { type: 'string', enum: ['gif', 'mp4', 'webm'], description: 'Output format' },
        output_path:  { type: 'string', description: 'Output file path (auto-derived if omitted)' },
        fps:          { type: 'number', description: 'Frames per second (default 10 for gif, 30 for mp4/webm)' },
        duration:     { type: 'number', description: 'Animation duration in ms (default 3000)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'type'],
    },
  },
  {
    name: 'setup_remote_presenter',
    description: 'Generate remote clicker setup: client JS snippet + curl commands to control slides over HTTP.',
    inputSchema: {
      type: 'object',
      properties: {
        port:         { type: 'number', description: 'Port for the remote server (default 3737)' },
        design_path:  { type: 'string', description: 'Optional: path to .design.yaml' },
        project_path: { type: 'string', description: 'Project dir' },
      },
    },
  },
  {
    name: 'setup_collab',
    description: 'Generate collaborative editing server setup: SSE file-watch server for multi-user design sync.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml to watch' },
        port:         { type: 'number', description: 'Port for the collab server (default 3738)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
];
