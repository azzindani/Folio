// §7 Tier 3 — Output + Advanced (8 tools): inspect/preview, export, editor link,
// and the four advanced subsystems (templates, reports, presentations, animation)
// each folded into ONE multiplexed tool with an `op` discriminator. Capability is
// identical to the old per-tool surface — only the tool count shrank.
import type { ToolDefinition } from '../types';

export const TIER3_TOOLS: ToolDefinition[] = [
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
    name: 'export_design',
    description: 'Export a design to SVG, PNG, PDF, HTML or PPTX (all produce real files). A carousel exports one file per page (`<name>-p1.svg`, `-p2.svg`, …); output_paths lists them. pdf is a true VECTOR PDF: text is embedded as real, selectable/copy-paste glyphs that stay crisp at any zoom, drawn over a high-DPI raster for backgrounds/gradients/effects, with clickable links — no Puppeteer/Chromium needed. pptx is a PowerPoint deck — one full-bleed image slide per page (pixel-faithful; opens in PowerPoint/Keynote/Slides as an editable container). For an INTERACTIVE report use report(op:export); for a presentation HTML/video use presentation(op:export) / animation(op:export).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        format:       { type: 'string', enum: ['svg', 'html', 'pdf', 'png', 'pptx'] },
        output_path:  { type: 'string', description: 'Output path (auto-derived if omitted)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        scale:        { type: 'number', description: 'Scale factor 1–3', default: 2 },
      },
      required: ['design_path', 'format'],
    },
  },
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
    name: 'templates',
    description: 'Built-in template catalog + reusable components — pick `op`:\n• list — browse the 432 built-in catalog templates (same as the editor Catalog); slim metadata {id,name,type,tags,width,height,slots,themeRef}; filter search/tag/limit. Feed a returned id straight to op:slots / op:inject.\n• slots — list injectable slots (paths/types/hints) of a template (req: template_path = a real .template.yaml path OR a built-in catalog id).\n• inject — fill slot values → a new .design.yaml (req: template_path, slots map; a built-in writes into the projects dir).\n• export — turn a sealed design into a reusable .template.yaml skeleton with named slots (req: design_path).\n• save_component — extract layers into a .component.yaml + replace them with an instance (req: design_path, layer_ids, component_name, project_path).\n• batch — generate N designs from one template + an array of slot objects (req: project_path, template_id = a built-in catalog id OR a project .template.yaml id OR a design name to clone, slots_array).',
    inputSchema: {
      type: 'object',
      properties: {
        op:             { type: 'string', enum: ['list', 'slots', 'inject', 'export', 'save_component', 'batch'], description: 'Which template/component action to run.' },
        search:         { type: 'string', description: 'op:list — free-text match over id/name/tags.' },
        tag:            { type: 'string', description: 'op:list — exact tag filter (e.g. "poster", "resume").' },
        limit:          { type: 'number', description: 'op:list — max results (default 60, max 300).' },
        template_path:  { type: 'string', description: 'op:slots/inject — a real .template.yaml path OR a built-in catalog id / filename (see op:list).' },
        slots:          { type: 'object', description: 'op:inject — map of slot_id → value.', properties: {} },
        output_path:    { type: 'string', description: 'op:inject/export — output path (auto if omitted).' },
        design_path:    { type: 'string', description: 'op:export/save_component — source .design.yaml.' },
        project_path:   { type: 'string', description: 'Project dir (op:export/save_component/batch).' },
        layer_ids:      { type: 'array', description: 'op:save_component — layer IDs to extract.', items: { type: 'string' } },
        component_name: { type: 'string', description: 'op:save_component — name for the new component.' },
        template_id:    { type: 'string', description: 'op:batch — a built-in catalog id, a project .template.yaml id, or a design name in the project to clone.' },
        slots_array:    { type: 'array', description: 'op:batch — one slot object per design.', items: { type: 'object' } },
      },
      required: ['op'],
    },
  },
  {
    name: 'report',
    description: 'Interactive data-report subsystem (type:report designs) — pick `op`:\n• generate — scaffold a report with pages/nav/optional data; layout:"flow" = responsive 12-col interactive dashboard (set accent + font_heading/font_body) (req: project_path, name, pages).\n• bind_data — attach/update inline datasets for $data.* / $agg.* expressions (req: design_path, datasets:[{id,rows[]}]).\n• validate — lint cross-refs (charts/tables/filters resolve to real datasets+fields, buttons open real modals) BEFORE export; returns {ok,errors,warnings} (req: design_path).\n• export — assemble into a self-contained interactive HTML; returns view_url (the real result to give the user) + edit_url (req: design_path).\n• formula — store state/data context for =expr bindings on a design (req: design_path).\n• debug — evaluate one =formula against a context and return the typed result (req: formula).',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['generate', 'bind_data', 'validate', 'export', 'formula', 'debug'], description: 'Which report action to run.' },
        project_path: { type: 'string', description: 'Project dir (op:generate; resolves relative design_path elsewhere).' },
        name:         { type: 'string', description: 'op:generate — report name.' },
        layout:       { type: 'string', enum: ['paged', 'scroll', 'tabs', 'sidebar', 'flow'], default: 'paged', description: 'op:generate — flow = responsive 12-col interactive grid.' },
        nav_type:     { type: 'string', enum: ['sidebar', 'topbar', 'tabs', 'dots'], default: 'sidebar', description: 'op:generate — navigation style.' },
        pages:        { type: 'array', description: 'op:generate — [{id?, label}] page specs.', items: { type: 'object' } },
        width:        { type: 'number', default: 1080, description: 'op:generate — canvas width.' },
        height:       { type: 'number', default: 1080, description: 'op:generate — canvas height.' },
        data_sources: { type: 'array', description: 'op:generate — optional inline/json/csv data sources.', items: { type: 'object' } },
        max_width:    { type: 'number', description: 'op:generate (flow) — centered container max width px (default 1200).' },
        accent:       { type: 'string', description: 'op:generate (flow) — accent color seeding charts/links/active states.' },
        font_heading: { type: 'string', description: 'op:generate (flow) — heading font family (Google font name).' },
        font_body:    { type: 'string', description: 'op:generate (flow) — body font family (Google font name).' },
        design_path:  { type: 'string', description: 'op:bind_data/validate/export/formula/debug — the .design.yaml.' },
        datasets:     { type: 'array', description: 'op:bind_data — [{id, rows[]}].', items: { type: 'object' } },
        output_path:  { type: 'string', description: 'op:export — output .html path (auto if omitted).' },
        theme:        { type: 'string', enum: ['light', 'dark'], default: 'dark', description: 'op:export — report theme.' },
        state:        { type: 'object', description: 'op:formula/debug — state variables.', properties: {} },
        data:         { type: 'object', description: 'op:formula/debug — data variables.', properties: {} },
        formula:      { type: 'string', description: 'op:debug — formula string starting with =.' },
      },
      required: ['op'],
    },
  },
  {
    name: 'presentation',
    description: 'Slide presentations + live presenting/collab — pick `op`:\n• create — scaffold a presentation design (1920×1080) with slides + transition (req: project_path, name, pages:[{label,notes?}]).\n• export — assemble a presentation/carousel/motion into a self-contained HTML presenter with transitions + keyboard nav (req: design_path).\n• remote — generate a remote-clicker setup: client JS + curl commands to drive slides over HTTP (opt: port, design_path).\n• collab — generate a collaborative-editing SSE file-watch server for multi-user sync (req: design_path).',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['create', 'export', 'remote', 'collab'], description: 'Which presentation action to run.' },
        project_path: { type: 'string', description: 'Project dir (op:create; resolves relative design_path elsewhere).' },
        name:         { type: 'string', description: 'op:create — presentation name.' },
        pages:        { type: 'array', description: 'op:create — [{id?, label, notes?}] slide specs.', items: { type: 'object' } },
        transition:   { type: 'string', enum: ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'flip-h', 'flip-v', 'cube-left', 'cube-right', 'reveal', 'wipe-left', 'wipe-right', 'dissolve', 'morph'], default: 'fade', description: 'op:create — slide transition.' },
        auto_advance: { type: 'number', description: 'op:create/export — auto-advance delay ms (0 = manual).' },
        width:        { type: 'number', default: 1920, description: 'op:create — slide width.' },
        height:       { type: 'number', default: 1080, description: 'op:create — slide height.' },
        theme:        { type: 'string', enum: ['dark', 'light'], default: 'dark', description: 'op:create/export — presenter theme.' },
        design_path:  { type: 'string', description: 'op:export/remote/collab — the .design.yaml.' },
        output_path:  { type: 'string', description: 'op:export — output .html path (auto if omitted).' },
        port:         { type: 'number', description: 'op:remote (default 3737) / op:collab (default 3738) — server port.' },
      },
      required: ['op'],
    },
  },
  {
    name: 'animation',
    description: 'Animation timeline + motion export — pick `op`:\n• timeline — show a design\'s keyframe tracks as an ASCII timeline (req: design_path; page_id to filter).\n• keyframe — add/replace a keyframe on a layer\'s timeline (req: design_path, layer_id, keyframe:{t:ms, x?, y?, opacity?, scale?, rotation?}).\n• export — write a motion file (req: design_path, type). type:"svg" and type:"html" are the DEFAULT CHOICE: real animated files written in-process, no extra software, vector-sharp at any size and usually a few KB. type:"gif"/"mp4"/"webm" are raster and need Puppeteer + ffmpeg installed on the host — they return a clear error where those are absent rather than a broken file.',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['timeline', 'keyframe', 'export'], description: 'Which animation action to run.' },
        design_path:  { type: 'string', description: 'Path to .design.yaml.' },
        page_id:      { type: 'string', description: 'op:timeline — page filter. op:export — which page of a multi-page design to render (default: first).' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path.' },
        layer_id:     { type: 'string', description: 'op:keyframe — target layer id.' },
        keyframe:     { type: 'object', description: 'op:keyframe — {t:ms, x?, y?, opacity?, scale?, rotation?}.', properties: {} },
        type:         { type: 'string', enum: ['svg', 'html', 'gif', 'mp4', 'webm'], description: 'op:export — output format. svg = self-contained animated SVG (no dependencies, vector). html = the same SVG in a shareable single file that honors prefers-reduced-motion. gif/mp4/webm = raster, host must have Puppeteer + ffmpeg.' },
        output_path:  { type: 'string', description: 'op:export — output file path (auto if omitted).' },
        fps:          { type: 'number', description: 'op:export — frames per second (default 10 gif, 30 mp4/webm).' },
        duration:     { type: 'number', description: 'op:export — animation duration ms (default 3000).' },
      },
      required: ['op', 'design_path'],
    },
  },
];
