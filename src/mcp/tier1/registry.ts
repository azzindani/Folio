// §7 Tier 1 — Basic (10 tools, 128K context): project management, navigation, tasks
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
          enum: ['quick_ref', 'shorthand', 'layers', 'workflow'],
          description: 'Guide section to load (default: quick_ref)',
          default: 'quick_ref',
        },
      },
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
        name:   { type: 'string', description: 'Project name' },
        path:   { type: 'string', description: 'Absolute directory path for the project' },
        theme:  { type: 'string', description: 'Theme ID (default: dark-tech)', default: 'dark-tech' },
        canvas: { type: 'string', description: 'Canvas size e.g. "1080x1080"', default: '1080x1080' },
      },
      required: ['name', 'path'],
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
        theme:        { type: 'string', description: 'Theme ID (default: dark-tech)' },
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
