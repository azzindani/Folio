// §7 Tier 3 — Advanced (6 tools): export, batch, templates, components
import type { ToolDefinition } from '../types';

export const TIER3_TOOLS: ToolDefinition[] = [
  {
    name: 'export_design',
    description: 'Export a design to SVG, HTML, PNG, or PDF. PNG/PDF requires Puppeteer (Phase 2).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to .design.yaml file' },
        format:      { type: 'string', enum: ['png', 'svg', 'html', 'pdf'] },
        output_path: { type: 'string', description: 'Output file path (derived if omitted)' },
        scale:       { type: 'number', description: 'Scale factor 1–3', default: 2 },
      },
      required: ['design_path', 'format'],
    },
  },
  {
    name: 'batch_create',
    description: 'Generate N designs from one template by providing an array of slot objects.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        template_id:  { type: 'string', description: 'Template ID to use' },
        slots_array:  { type: 'object', description: 'Array of slot objects, one per design', items: { type: 'object' } },
      },
      required: ['project_path', 'template_id', 'slots_array'],
    },
  },
  {
    name: 'save_as_component',
    description: 'Extract layers from a design into a reusable .component.yaml and replace with an instance.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:    { type: 'string', description: 'Path to source .design.yaml file' },
        layer_ids:      { type: 'object', description: 'Array of layer IDs to extract', items: { type: 'string' } },
        component_name: { type: 'string', description: 'Name for the new component' },
        project_path:   { type: 'string', description: 'Path to project directory' },
      },
      required: ['design_path', 'layer_ids', 'component_name', 'project_path'],
    },
  },
  {
    name: 'export_template',
    description: 'Export a design as a .template.yaml skeleton with named slots.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path: { type: 'string', description: 'Path to source .design.yaml file' },
        output_path: { type: 'string', description: 'Output path for .template.yaml (auto-derived if omitted)' },
      },
      required: ['design_path'],
    },
  },
  {
    name: 'inject_template',
    description: 'Inject slot values into a template to produce a complete .design.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        template_path: { type: 'string', description: 'Path to .template.yaml file' },
        slots:         { type: 'object', description: 'Map of slot_id → value', properties: {} },
        output_path:   { type: 'string', description: 'Output path for .design.yaml (auto-derived if omitted)' },
      },
      required: ['template_path', 'slots'],
    },
  },
  {
    name: 'list_template_slots',
    description: 'List injectable slots in a .template.yaml with paths, types, and hints.',
    inputSchema: {
      type: 'object',
      properties: { template_path: { type: 'string', description: 'Path to .template.yaml file' } },
      required: ['template_path'],
    },
  },
];
