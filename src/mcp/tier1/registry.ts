// §7 Tier 1 — Basic (15 tools): project management, navigation, tasks, library, theming
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
          enum: ['quick_ref', 'shorthand', 'layers', 'workflow', 'reference'],
          description: 'Guide section to load (default: quick_ref)',
          default: 'quick_ref',
        },
      },
    },
  },
  {
    name: 'enrich_brief',
    description: 'START HERE when the prompt is SHORT or vague (e.g. "a poster about remote work" or "a 6-slide carousel on X"). Turns a one-line idea into a RICH content plan so the output is dense, not sparse. For a single design: infers the best preset + a full block/field outline (the richness floor). For a CAROUSEL/deck/slides (auto-detected, or pass type:"carousel"): returns output_type:"carousel" + page_count + a per-page plan (pages:[{role,label,preset,hints}]) following a cohesive cover→content→data→takeaway arc with ONE shared bg_style/palette. Either way it picks a topic-matched bg_style + palette + colors and — for factual topics — the exact web-research queries to run FIRST so figures are real, not invented. Returns needs_research + research_queries + an instruction; follow it (research if asked) then create_design/create_task + add_layers/append_page.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The user\'s topic/intent — even one line, e.g. "the state of remote work" or "a feature poster for my CI tool".' },
        type:   { type: 'string', description: 'Optional preset hint (sections/feature_grid/stat/event/list/split/editorial). Omit to let the engine infer it.' },
        variant: { type: 'number', description: 'Optional. For "give me N OPTIONS of the same topic": call once per option with variant:0,1,2,… — each returns a DISTINCT art-direction (palette + typography treatment + background geometry) for the same content. 0 = the topic-apt default. Deterministic, so variant 3 always looks the same.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List task files in a project with progress status.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
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
    name: 'list_designs',
    description: 'List designs in a project. Returns max 40 items.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
    },
  },
  {
    name: 'browse_library',
    description: 'Browse the WHOLE design library — every project and design stored in the projects dir, not just one project (list_designs is per-project). Your file-manager view of the collection: each design\'s name, type, canvas size, page count and last-modified, grouped by project, newest first. Use it to find a design across projects, see everything you\'ve made, or pick something to reopen. Filter with `search` (matches project or design name), `type` (poster/carousel/report/…) or `project`; sort by modified/name/designs. Pass include_links:true to get an open-in-editor URL per design. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        search:        { type: 'string', description: 'Substring filter on project OR design name' },
        type:          { type: 'string', description: 'Only designs of this type (poster/carousel/report/presentation/motion)' },
        project:       { type: 'string', description: 'Only projects whose name contains this' },
        sort:          { type: 'string', enum: ['modified', 'name', 'designs'], description: 'Sort projects (default: modified, newest first)' },
        limit:         { type: 'number', description: 'Max projects to return (default 40, max 200)' },
        designs_per_project: { type: 'number', description: 'Max designs shown per project (default 8, max 40)' },
        include_links: { type: 'boolean', description: 'Add an open-in-editor URL per design (default false)' },
      },
    },
  },
  {
    name: 'rename_design',
    description: 'Rename a design\'s display name (its meta.name, what the library shows). The FILE path is left unchanged on purpose so existing editor links never break. Library-management op — pair with browse_library.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to the .design.yaml' },
        new_name:     { type: 'string', description: 'New display name' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'new_name'],
    },
  },
  {
    name: 'delete_design',
    description: 'Delete a design by moving it to the project\'s .trash/ (RECOVERABLE — never a hard delete; restore by moving it back out). Library-management op.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to the .design.yaml to delete' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'move_design',
    description: 'Move a design\'s file into another project (name collisions get a suffix). Returns the new path + an editor link. Library-management op — the target project must already exist (create_project).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:    { type: 'string', description: 'Path to the .design.yaml to move' },
        target_project: { type: 'string', description: 'Destination project (bare name like "my-project" or a path)' },
        project_path:   { type: 'string', description: 'Source project dir — enables relative design_path' },
      },
      required: ['design_path', 'target_project'],
    },
  },
  {
    name: 'list_themes',
    description: 'List available themes registered in project.yaml.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
    },
  },
  {
    name: 'apply_theme',
    description: 'Set active theme for a project. Updates project.yaml default_theme.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        theme_id:     { type: 'string', description: 'Theme ID to activate' },
      },
      required: ['project_path', 'theme_id'],
    },
  },
  {
    name: 'duplicate_design',
    description: 'Copy a design with a new name and UUID. Registers in project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to source .design.yaml' },
        new_name:     { type: 'string', description: 'Name for the duplicated design' },
        project_path: { type: 'string', description: 'Project directory (for registry update)' },
      },
      required: ['design_path', 'new_name'],
    },
  },
  {
    name: 'resume_design',
    description: 'Read carousel generation state to continue appending pages.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml file' },
        project_path: { type: 'string', description: 'Project dir (optional — enables relative paths)' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'create_task',
    description: 'Plan multi-page carousel + scaffold. Returns first append_page baton.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        task_name:    { type: 'string', description: 'Task / design name' },
        brief:        { type: 'string', description: 'One-sentence description of the full design' },
        theme:        { type: 'string', description: 'Theme ID (default: editorial-cream — flat/art-directed; avoid dark glowy themes)' },
        width:        { type: 'number', description: 'Canvas width px', default: 1080 },
        height:       { type: 'number', description: 'Canvas height px', default: 1080 },
        pages: {
          type: 'object',
          description: 'Page plan: [{label:"Cover",hints:"bold headline"}]',
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
      },
      required: ['project_path', 'task_name', 'brief', 'pages'],
    },
  },
  {
    name: 'resume_task',
    description: 'Read task state and get exact next tool call. Use after context reset.',
    inputSchema: {
      type: 'object',
      properties: { task_path: { type: 'string', description: 'Path to .task.yaml (from create_task)' } },
      required: ['task_path'],
    },
  },
];
