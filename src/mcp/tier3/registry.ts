// §7 Tier 3 — Advanced (6 tools): export, batch, templates, components
import type { ToolDefinition } from '../types';

export const TIER3_TOOLS: ToolDefinition[] = [
  {
    name: 'export_design',
    description: 'Export design to SVG or HTML. PNG/PDF needs Puppeteer (Phase 2).',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to .design.yaml' },
        format:       { type: 'string', enum: ['png', 'svg', 'html', 'pdf'] },
        output_path:  { type: 'string', description: 'Output path (auto-derived if omitted)' },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
        scale:        { type: 'number', description: 'Scale factor 1–3', default: 2 },
      },
      required: ['design_path', 'format'],
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
        slots_array:  { type: 'object', description: 'One slot object per design', items: { type: 'object' } },
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
        layer_ids:      { type: 'object', description: 'Layer IDs to extract', items: { type: 'string' } },
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
    description: 'Scaffold a new report-type design with pages, navigation, and optional data sources.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path:  { type: 'string', description: 'Path to project directory' },
        name:          { type: 'string', description: 'Report name' },
        layout:        { type: 'string', enum: ['paged', 'scroll', 'tabs', 'sidebar'], default: 'paged' },
        nav_type:      { type: 'string', enum: ['sidebar', 'topbar', 'tabs', 'dots'], default: 'sidebar' },
        pages:         { type: 'object', description: 'Array of {id?, label} page specs', items: { type: 'object' } },
        width:         { type: 'number', default: 1080 },
        height:        { type: 'number', default: 1080 },
        data_sources:  { type: 'object', description: 'Optional inline/json/csv data sources', items: { type: 'object' } },
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
        datasets:     { type: 'object', description: 'Array of {id, rows[]}', items: { type: 'object' } },
        project_path: { type: 'string', description: 'Project dir — enables relative design_path' },
      },
      required: ['design_path', 'datasets'],
    },
  },
  {
    name: 'export_report',
    description: 'Assemble a report design into a self-contained interactive HTML file.',
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
];
