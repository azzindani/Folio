// §7 Tier 1 — Basic (10 tools, 128K context): project management, navigation, tasks
import type { ToolDefinition } from '../types';

export const TIER1_TOOLS: ToolDefinition[] = [
  {
    name: 'get_engine_guide',
    description: 'Load the Folio engine reference: layer types, shorthand syntax, workflow patterns, token budget. Call ONCE at session start before generating any designs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks',
    description: 'List all task files (.task.yaml) in a project with progress status. Use to find task_path after a context reset.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new design project with directory structure, default theme, and project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Project name' },
        path:   { type: 'string', description: 'Absolute directory path to create project in' },
        theme:  { type: 'string', description: 'Theme ID (default: dark-tech)', default: 'dark-tech' },
        canvas: { type: 'string', description: 'Canvas size e.g. "1080x1080"', default: '1080x1080' },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'list_designs',
    description: 'List designs in a project. Returns max 40 items with truncated/total fields.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
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
    description: 'Copy an existing design with a new name and UUID. Registers copy in project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to source .design.yaml file' },
        new_name:     { type: 'string', description: 'Name for the duplicated design' },
        project_path: { type: 'string', description: 'Path to project directory (for registry update)' },
      },
      required: ['design_path', 'new_name'],
    },
  },
  {
    name: 'resume_design',
    description: 'Read generation state of an in-progress carousel so the LLM can continue appending pages.',
    inputSchema: {
      type: 'object',
      properties: { design_path: { type: 'string', description: 'Path to .design.yaml file' } },
      required: ['design_path'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a multi-page task plan + carousel scaffold. Returns next_action baton pointing to the first append_page call. Use for any design with more than one page.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        task_name:    { type: 'string', description: 'Task / design name' },
        brief:        { type: 'string', description: 'One-sentence description of the full design' },
        theme:        { type: 'string', description: 'Theme ID (default: dark-tech)' },
        width:        { type: 'number', description: 'Canvas width px', default: 1080 },
        height:       { type: 'number', description: 'Canvas height px', default: 1080 },
        pages: {
          type: 'object',
          description: 'Ordered page plan: [{label:"Cover",hints:"bold headline + logo"}, ...]',
          items: {
            type: 'object',
            properties: {
              id:    { type: 'string', description: 'Page ID (auto-generated if omitted)' },
              label: { type: 'string', description: 'Page title / purpose' },
              hints: { type: 'string', description: 'Brief content guidance for this page' },
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
    description: 'Read task state and get the exact next tool call to make. Call this whenever context resets mid-generation or to check progress.',
    inputSchema: {
      type: 'object',
      properties: { task_path: { type: 'string', description: 'Path to .task.yaml file (returned by create_task)' } },
      required: ['task_path'],
    },
  },
];
