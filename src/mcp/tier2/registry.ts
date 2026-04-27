// §7 Tier 2 — Medium (9 tools): design lifecycle & layer manipulation
import type { ToolDefinition } from '../types';

export const TIER2_TOOLS: ToolDefinition[] = [
  {
    name: 'inspect_design',
    description: 'Surgical read: layer IDs, types, z-order, positions. Low token cost.',
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
    description: 'Add multiple layers at once. Use layers_shorthand for 80% token savings.',
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
    description: 'Append a page to carousel. Accepts template+slots or raw layers.',
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
    description: 'Surgical field update via dot-path selectors. Snapshots before write.',
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
    description: 'Mark design complete. Sets _mode to "complete". Call after all layers added.',
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
    description: 'Add a single layer to a design or page.',
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
