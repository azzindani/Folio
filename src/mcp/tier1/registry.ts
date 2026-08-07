// §7 Tier 1 — Foundation (6 tools): guidance, project, design/library management,
// theming, multi-page tasks. (Consolidated surface — manage_design/themes/tasks
// fold the old per-op tools onto an `op` discriminator; capability unchanged.)
import type { ToolDefinition } from '../types';

export const TIER1_TOOLS: ToolDefinition[] = [
  {
    name: 'get_engine_guide',
    description: 'Load engine guide section. Default: quick_ref (~200 tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['quick_ref', 'shorthand', 'layers', 'workflow', 'reference', 'assets',
            'craft', 'anti_slop', 'color', 'type', 'ux_laws', 'a11y', 'marks'],
          description: 'Guide section to load (default: quick_ref). assets = photos/logos/fonts in designs (asset_add/asset_list workflow). craft/anti_slop/color/type/ux_laws/a11y = universal design-craft rulebooks. marks = identity/logo construction (optical centring, overshoot, small-size survival, lockups, clearspace) — the engine measures a mark you draw, it never generates one.',
          default: 'quick_ref',
        },
      },
    },
  },
  {
    name: 'enrich_brief',
    description: 'START HERE when the prompt is SHORT or vague (e.g. "a poster about remote work" or "a 6-slide carousel on X"). Turns a one-line idea into a RICH content plan so the output is dense, not sparse. For a single design: infers the best preset + a full block/field outline (the richness floor). For a CAROUSEL/deck/slides (auto-detected, or pass type:"carousel"): returns output_type:"carousel" + page_count + a per-page plan (pages:[{role,label,preset,hints}]) following a cohesive cover→content→data→takeaway arc with ONE shared bg_style/palette. Either way it picks a topic-matched bg_style + palette + colors and — for factual topics — the exact web-research queries to run FIRST so figures are real, not invented. Returns needs_research + research_queries + an instruction; follow it (research if asked) then create_design/tasks(op:create) + add_layers/append_page.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The user\'s topic/intent — even one line, e.g. "the state of remote work" or "a feature poster for my CI tool".' },
        type:   { type: 'string', description: 'Optional preset hint (sections/feature_grid/stat/event/list/split/editorial). Omit to let the engine infer it.' },
        variant: { type: 'number', description: 'Optional — OMIT for a normal single-design request (the default: one design only). Use ONLY when the user EXPLICITLY asks for N OPTIONS/variations of the same topic: call once per option with variant:0,1,2,… — each returns a DISTINCT art-direction (palette + typography treatment + background geometry) for the same content. 0 = the topic-apt default. Deterministic, so variant 3 always looks the same.' },
        project_path: { type: 'string', description: 'Optional — the target project (bare name). When it already holds uploaded assets (photos/logos), the plan tells you to asset_list + place them instead of leaving the design photo-less.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'create_project',
    description: 'Create project with directory structure, default theme, project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Project name, e.g. "ai-poster"' },
        path:   { type: 'string', description: 'Optional — defaults to the name. Pass a short BARE NAME like "ai-poster" (the engine places it in the projects dir automatically). Do NOT build absolute /home/... paths — you can\'t know the container layout.' },
        theme:  { type: 'string', description: 'Theme ID (default: editorial-cream — a flat, art-directed look; avoid dark glowy tech themes)', default: 'editorial-cream' },
        canvas: { type: 'string', description: 'Canvas size e.g. "1080x1080"', default: '1080x1080' },
      },
      required: ['name'],
    },
  },
  {
    name: 'manage_design',
    description: 'Find, inspect and manage designs, ASSETS + the whole library — one tool, pick `op`:\n• list — designs in ONE project (req: project_path).\n• browse — the WHOLE library across every project (file-manager view: name, type, canvas, pages, modified, newest first; filter search/type/project, sort modified|name|designs, include_links for editor URLs). Read-only.\n• inspect — read a design\'s structure (layer IDs/types/z-order/positions) cheaply to verify state or find a layer_id (req: design_path; page_id for one carousel page). Read-only.\n• rename — change a design\'s display name; the file path is left unchanged so editor links never break (req: design_path, new_name).\n• duplicate — copy a design with a new name + UUID (req: design_path, new_name).\n• move — move a design\'s file into another project, target must exist (req: design_path, target_project).\n• delete — move a design to the project .trash/ (recoverable, never a hard delete) (req: design_path).\n• resume — read a carousel\'s generation state to continue appending (req: design_path).\n• gallery — build a self-contained library.html file-manager with thumbnails + search (opt: output_path, max_thumbnails, search, type).\n• asset_add — store a photo/logo/font in the project\'s assets/ and get back its dims + dominant colors + a ready-to-place image-layer stub (req: project_path, name w/ extension, data = data: URI OR source_path; opt: kind:"icons", alt, process). `process` does pixel work during ingest — {remove_bg:true} cuts a flat backdrop out of a PNG logo/product shot so it sits on any canvas colour, {fit:{w,h,mode}} resamples to a target box. PNG input only. Then reference it as src:"assets/images/<name>" — never inline base64 into a design.\n• asset_list — every asset in the project with width/height, dominant_colors, luminance (dark|light|busy → busy needs a text scrim) and alt, so you can place images you cannot see (req: project_path; opt: search, kind, limit).\n• asset_delete — soft-delete an asset to .trash (req: project_path, asset_path like "assets/images/x.jpg").',
    inputSchema: {
      type: 'object',
      properties: {
        op:            { type: 'string', enum: ['list', 'browse', 'inspect', 'rename', 'duplicate', 'move', 'delete', 'resume', 'gallery', 'asset_add', 'asset_list', 'asset_delete', 'asset_move'], description: 'Which management action to run.' },
        project_path:  { type: 'string', description: 'Project dir / bare name. Required for op:list; for others, resolves a relative design_path.' },
        design_path:   { type: 'string', description: 'Path to the .design.yaml (op: inspect/rename/duplicate/move/delete/resume).' },
        new_name:      { type: 'string', description: 'op:rename/duplicate — the new display name. op:asset_move — the new filename (extension must stay the same).' },
        target_project: { type: 'string', description: 'op:move — destination project (bare name or path; must exist).' },
        page_id:       { type: 'string', description: 'op:inspect — a carousel page id (omit to list pages).' },
        search:        { type: 'string', description: 'op:browse/gallery — substring filter on project OR design name.' },
        type:          { type: 'string', description: 'op:browse/gallery — only designs of this type (poster/carousel/report/presentation/motion).' },
        project:       { type: 'string', description: 'op:browse — only projects whose name contains this.' },
        sort:          { type: 'string', enum: ['modified', 'name', 'designs'], description: 'op:browse — sort order (default modified, newest first).' },
        limit:         { type: 'number', description: 'op:browse — max projects (default 40, max 200).' },
        designs_per_project: { type: 'number', description: 'op:browse — max designs shown per project (default 8, max 40).' },
        include_links: { type: 'boolean', description: 'op:browse — add an open-in-editor URL per design (default false).' },
        output_path:   { type: 'string', description: 'op:gallery — where to write the gallery HTML (default <projects>/library.html).' },
        max_thumbnails: { type: 'number', description: 'op:gallery — max NEW thumbnails to render this call (default 120; cached are free).' },
        name:          { type: 'string', description: 'op:asset_add — filename WITH extension (png/jpg/webp/gif/avif/svg/ttf/otf/woff2), e.g. "team.jpg".' },
        data:          { type: 'string', description: 'op:asset_add — the file as a data: URI (data:image/png;base64,…). Alternative: source_path.' },
        source_path:   { type: 'string', description: 'op:asset_add — copy an existing file already under the projects dir instead of passing data.' },
        kind:          { type: 'string', enum: ['images', 'icons', 'fonts'], description: 'op:asset_add/asset_list — folder override/filter (auto-detected from the extension by default).' },
        alt:           { type: 'string', description: 'op:asset_add — short description of what the image shows (a vision-less model\'s only eyes — always provide it).' },
        process:       { type: 'object', description: 'op:asset_add — optional pixel work applied BEFORE the asset is stored, so its dominant_colors describe the processed result. {remove_bg:true} or {remove_bg:{tolerance:30,feather:1}} makes the border-connected backdrop transparent (an enclosed region of the same colour, like the hole in an \"O\", is kept). {fit:{w:800,h:600,mode:"cover"|"contain"}} resamples. PNG only — other formats return an error rather than silently skipping the work.', properties: {} },
        asset_path:    { type: 'string', description: 'op:asset_delete/asset_move — project-relative path like "assets/images/team.jpg" or "assets/images/<folder>/team.jpg" (from asset_list).' },
        folder:        { type: 'string', description: 'op:asset_add/asset_list/asset_move — ONE folder segment inside the kind dir, e.g. "power-automate" → assets/images/power-automate/step-1.png. Keeps a shoot or a tutorial\'s screenshots together. On asset_list, filters to that folder (pass "" for the root); the reply also lists every folder in the project. On asset_move, "" moves the asset back to the root.' },
      },
      required: ['op'],
    },
  },
  {
    name: 'themes',
    description: 'Themes + curated catalog packs — pick `op`:\n• list — themes registered in project.yaml + available builtins (req: project_path).\n• apply — set the active theme; updates project.yaml default_theme and lazily seeds a builtin if needed (req: project_path, theme_id).\n• packs — READ-ONLY catalog packs the editor offers, for hand-picking values (NO project_path needed). kind="palette" → curated colour sets (usable hexes), kind="type" → font pairings (heading/body/mono), kind="effects" → effect key sets. Omit kind for the three kinds + counts; pass search to filter by tag/name; pass id for ONE pack\'s full values to drop into layer fills/fonts/effects.\nNote: apply sets the PROJECT default; it does NOT recolor an existing design\'s baked-in hexes — use patch_design {path:"recolor"} for that.',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['list', 'apply', 'packs'], description: 'list, apply, or packs.' },
        project_path: { type: 'string', description: 'Path to project directory (op:list/apply).' },
        theme_id:     { type: 'string', description: 'op:apply — theme ID to activate.' },
        kind:         { type: 'string', enum: ['palette', 'type', 'effects'], description: 'op:packs — pack family. Omit for kinds + counts.' },
        id:           { type: 'string', description: 'op:packs — a pack id for its full usable values.' },
        search:       { type: 'string', description: 'op:packs — filter packs by tag/name/description.' },
        limit:        { type: 'number', description: 'op:packs — max packs in a listing (default 24, cap 60).' },
      },
      required: ['op'],
    },
  },
  {
    name: 'tasks',
    description: 'Multi-page carousel/deck task planning — pick `op`:\n• create — plan a multi-page design + scaffold it; returns the first append_page baton (req: project_path, task_name, brief, pages:[{label,hints}]).\n• list — task files in a project with progress status (req: project_path).\n• resume — read a task\'s state and get the exact next tool call, e.g. after a context reset (req: task_path).',
    inputSchema: {
      type: 'object',
      properties: {
        op:           { type: 'string', enum: ['create', 'list', 'resume'], description: 'create, list or resume.' },
        project_path: { type: 'string', description: 'Path to project directory (op:create/list).' },
        task_name:    { type: 'string', description: 'op:create — task / design name.' },
        brief:        { type: 'string', description: 'op:create — one-sentence description of the full design.' },
        theme:        { type: 'string', description: 'op:create — theme ID (default editorial-cream; flat/art-directed).' },
        width:        { type: 'number', description: 'op:create — canvas width px (default 1080).', default: 1080 },
        height:       { type: 'number', description: 'op:create — canvas height px (default 1080).', default: 1080 },
        pages: {
          type: 'object',
          description: 'op:create — page plan: [{label:"Cover",hints:"bold headline"}].',
          items: {
            type: 'object',
            properties: {
              id:    { type: 'string', description: 'Page ID (auto if omitted)' },
              label: { type: 'string', description: 'Page title / purpose' },
              hints: { type: 'string', description: 'Content guidance for this page' },
            },
            required: ['label'],
          },
        },
        task_path:    { type: 'string', description: 'op:resume — path to .task.yaml (from op:create).' },
      },
      required: ['op'],
    },
  },
];
