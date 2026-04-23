// §7 Tier 2 — Medium (7 tools): design lifecycle & layer manipulation
import type { ToolDefinition } from '../types';

export const TIER2_TOOLS: ToolDefinition[] = [
  {
    name: 'create_design',
    description: 'Create a new design file scaffold. Returns design_id and path.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
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
    description: 'Append a page to a carousel design. Accepts template_ref + slots or raw layers.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml file' },
        page_id:      { type: 'string', description: 'Page identifier' },
        label:        { type: 'string', description: 'Page label' },
        template_ref: { type: 'string', description: 'Template ID to use' },
        slots:            { type: 'object', description: 'Slot values for the template', properties: {} },
        layers:           { type: 'object', description: 'Full verbose layers array', items: { type: 'object' } },
        layers_shorthand: { type: 'object', description: 'Compact shorthand layers — saves ~80% output tokens. Preferred for local models.', items: { type: 'object' } },
        task_path:        { type: 'string', description: 'Path to .task.yaml — enables automatic next_action handover baton in response' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'patch_design',
    description: 'Surgical update to specific fields via dot-path selectors. Snapshots before write.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
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
    description: 'Mark a carousel design as complete. Sets _mode to "complete".',
    inputSchema: {
      type: 'object',
      properties: { design_path: { type: 'string', description: 'Path to .design.yaml file' } },
      required: ['design_path'],
    },
  },
  {
    name: 'add_layer',
    description: 'Add a layer to a design or specific page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        page_id:     { type: 'string', description: 'Page ID (carousel only)' },
        layer:       { type: 'object', description: 'Layer specification', properties: {} },
      },
      required: ['design_path', 'layer'],
    },
  },
  {
    name: 'update_layer',
    description: 'Update specific properties on a layer by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        layer_id:    { type: 'string', description: 'Layer ID to update' },
        props:       { type: 'object', description: 'Properties to merge', properties: {} },
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
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        layer_id:    { type: 'string', description: 'Layer ID to remove' },
      },
      required: ['design_path', 'layer_id'],
    },
  },
];
