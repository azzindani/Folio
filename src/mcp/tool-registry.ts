import type { ToolDefinition } from './types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── PROJECT ───────────────────────────────────────────────
  {
    name: 'create_project',
    description: 'Create a new design project with project.yaml, default theme, and directory structure.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        theme: { type: 'string', description: 'Theme ID (default: dark-tech)', default: 'dark-tech' },
        canvas: { type: 'string', description: 'Canvas size like "1080x1080"', default: '1080x1080' },
        path: { type: 'string', description: 'Directory path to create project in' },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'list_designs',
    description: 'List all designs in a project with their metadata and status.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
      },
      required: ['project_path'],
    },
  },

  // ── DESIGN LIFECYCLE ──────────────────────────────────────
  {
    name: 'create_design',
    description: 'Create a new design file with scaffold structure. Returns design_id and path.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        name: { type: 'string', description: 'Design name' },
        type: { type: 'string', enum: ['poster', 'carousel'], description: 'Design type', default: 'poster' },
        width: { type: 'number', description: 'Canvas width in px', default: 1080 },
        height: { type: 'number', description: 'Canvas height in px', default: 1080 },
        theme_ref: { type: 'string', description: 'Theme reference ID' },
      },
      required: ['project_path', 'name'],
    },
  },
  {
    name: 'append_page',
    description: 'Append a page to a carousel design. Accepts template_ref + slots or raw layers.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        page_id: { type: 'string', description: 'Page identifier' },
        label: { type: 'string', description: 'Page label' },
        template_ref: { type: 'string', description: 'Template ID to use' },
        slots: { type: 'object', description: 'Slot values for the template', properties: {} },
        layers: { type: 'object', description: 'Raw layers array (if not using template)', items: { type: 'object' } },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'patch_design',
    description: 'Surgical update to specific fields in a design by dot-path selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        selectors: {
          type: 'object',
          description: 'Array of {path, value} selectors',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      },
      required: ['design_path', 'selectors'],
    },
  },
  {
    name: 'seal_design',
    description: 'Mark a design as complete. Sets _mode to "complete" and generation.status to "complete".',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
      },
      required: ['design_path'],
    },
  },

  // ── LAYER MANIPULATION ────────────────────────────────────
  {
    name: 'add_layer',
    description: 'Add a layer to a design or specific page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        page_id: { type: 'string', description: 'Page ID (for carousel designs)' },
        layer: { type: 'object', description: 'Layer specification', properties: {} },
      },
      required: ['design_path', 'layer'],
    },
  },
  {
    name: 'update_layer',
    description: 'Update specific properties on a layer.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        layer_id: { type: 'string', description: 'Layer ID to update' },
        props: { type: 'object', description: 'Properties to update', properties: {} },
      },
      required: ['design_path', 'layer_id', 'props'],
    },
  },
  {
    name: 'remove_layer',
    description: 'Remove a layer by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        layer_id: { type: 'string', description: 'Layer ID to remove' },
      },
      required: ['design_path', 'layer_id'],
    },
  },

  // ── THEME ─────────────────────────────────────────────────
  {
    name: 'list_themes',
    description: 'List available themes in the project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
      },
      required: ['project_path'],
    },
  },

  // ── EXPORT ────────────────────────────────────────────────
  {
    name: 'export_design',
    description: 'Export a design to PNG, SVG, HTML, or PDF.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        format: { type: 'string', enum: ['png', 'svg', 'html', 'pdf'], description: 'Export format' },
        output_path: { type: 'string', description: 'Output file path' },
        scale: { type: 'number', description: 'Scale factor (1, 2, or 3)', default: 2 },
      },
      required: ['design_path', 'format'],
    },
  },

  // ── BATCH ─────────────────────────────────────────────────
  {
    name: 'batch_create',
    description: 'Generate N designs from 1 template with different slot values.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        template_id: { type: 'string', description: 'Template ID to use' },
        slots_array: {
          type: 'object',
          description: 'Array of slot objects, one per design',
          items: { type: 'object' },
        },
      },
      required: ['project_path', 'template_id', 'slots_array'],
    },
  },
];
