import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DesignSpec, ThemeSpec, Layer, Page } from '../schema/types';
import type { ToolCallResult } from './types';
import { validateDesignSpec } from '../schema/validator';
import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';

function textResult(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function readYAML<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as T;
}

function writeYAML(filePath: string, data: unknown): void {
  const content = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── create_project ──────────────────────────────────────────
export function createProject(args: { name: string; path: string; theme?: string; canvas?: string }): ToolCallResult {
  const projectDir = args.path;
  const [width, height] = (args.canvas ?? '1080x1080').split('x').map(Number);

  if (fs.existsSync(projectDir)) {
    return errorResult(`Directory already exists: ${projectDir}`);
  }

  // Create directory structure
  const dirs = ['themes', 'components', 'templates', 'designs', 'assets/fonts', 'assets/icons', 'assets/images', 'exports'];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }

  // Create default theme
  const theme: ThemeSpec = {
    _protocol: 'theme/v1',
    name: 'Dark Tech',
    version: '1.0.0',
    colors: { background: '#1A1A2E', surface: '#16213E', primary: '#E94560', secondary: '#3D9EE4', text: '#FFFFFF', text_muted: '#8892A4', border: '#2A2A4A' },
    typography: {
      scale: { h1: { size: 72, weight: 700, line_height: 1.1 }, h2: { size: 48, weight: 700, line_height: 1.2 }, body: { size: 18, weight: 400, line_height: 1.6 } },
      families: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    },
    spacing: { unit: 8, scale: [0, 4, 8, 16, 24, 32, 48, 64] },
    effects: { shadow_card: '0 4px 24px rgba(0,0,0,0.4)' },
    radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
  };
  writeYAML(path.join(projectDir, 'themes/dark-tech.theme.yaml'), theme);

  // Create project manifest
  const project = {
    _protocol: 'project/v1',
    meta: { id: generateId(), name: args.name, version: '1.0.0', created: new Date().toISOString().split('T')[0], modified: new Date().toISOString().split('T')[0] },
    config: { default_theme: args.theme ?? 'dark-tech', default_canvas: `${width}x${height}`, default_export_format: 'png' },
    themes: [{ id: 'dark-tech', path: 'themes/dark-tech.theme.yaml', active: true }],
    components: { registry: 'components/index.yaml' },
    templates: { registry: 'templates/index.yaml' },
    designs: [],
    assets: { fonts: [], images: [] },
    exports: [],
  };
  writeYAML(path.join(projectDir, 'project.yaml'), project);

  // Create empty registries
  writeYAML(path.join(projectDir, 'components/index.yaml'), { components: [] });
  writeYAML(path.join(projectDir, 'templates/index.yaml'), { templates: [] });

  return textResult(JSON.stringify({ project_id: project.meta.id, path: projectDir }));
}

// ── list_designs ────────────────────────────────────────────
export function listDesigns(args: { project_path: string }): ToolCallResult {
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) {
    return errorResult(`Project not found: ${projectPath}`);
  }
  const project = readYAML<{ designs: unknown[] }>(projectPath);
  return textResult(JSON.stringify(project.designs ?? []));
}

// ── create_design ───────────────────────────────────────────
export function createDesign(args: {
  project_path: string;
  name: string;
  type?: string;
  width?: number;
  height?: number;
  theme_ref?: string;
}): ToolCallResult {
  const designId = args.name.toLowerCase().replace(/\s+/g, '-');
  const designPath = path.join(args.project_path, `designs/${designId}.design.yaml`);
  const type = args.type ?? 'poster';

  const spec: DesignSpec = {
    _protocol: 'design/v1',
    _mode: type === 'carousel' ? 'in_progress' : 'complete',
    meta: {
      id: generateId(),
      name: args.name,
      type: type as 'poster' | 'carousel',
      created: new Date().toISOString().split('T')[0],
      modified: new Date().toISOString().split('T')[0],
      generator: 'mcp',
      generation: type === 'carousel'
        ? { status: 'in_progress', total_pages: 0, completed_pages: 0 }
        : undefined,
    },
    document: { width: args.width ?? 1080, height: args.height ?? 1080, unit: 'px', dpi: 96 },
    theme: { ref: args.theme_ref ?? 'dark-tech' },
    ...(type === 'carousel' ? { pages: [] } : { layers: [] }),
  };

  writeYAML(designPath, spec);

  // Register in project.yaml
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (fs.existsSync(projectPath)) {
    const project = readYAML<{ designs: unknown[] }>(projectPath);
    project.designs = project.designs ?? [];
    project.designs.push({ id: designId, path: `designs/${designId}.design.yaml`, type, status: 'draft' });
    writeYAML(projectPath, project);
  }

  return textResult(JSON.stringify({ design_id: spec.meta.id, path: designPath }));
}

// ── append_page ─────────────────────────────────────────────
export function appendPage(args: {
  design_path: string;
  page_id?: string;
  label?: string;
  template_ref?: string;
  slots?: Record<string, unknown>;
  layers?: Layer[];
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  if (!spec.pages) spec.pages = [];

  const pageId = args.page_id ?? `page_${spec.pages.length + 1}`;
  const newPage: Page = {
    id: pageId,
    label: args.label ?? `Page ${spec.pages.length + 1}`,
    template_ref: args.template_ref,
    slots: args.slots,
    layers: args.layers ?? [],
  };

  spec.pages.push(newPage);

  // Update generation meta
  if (spec.meta.generation) {
    spec.meta.generation.completed_pages = spec.pages.length;
    spec.meta.generation.total_pages = Math.max(spec.meta.generation.total_pages, spec.pages.length);
    spec.meta.generation.last_operation = 'append_page';
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({ page_id: pageId, page_count: spec.pages.length }));
}

// ── patch_design ────────────────────────────────────────────
export function patchDesign(args: {
  design_path: string;
  selectors: { path: string; value: unknown }[];
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<Record<string, unknown>>(args.design_path);
  const patched: string[] = [];

  for (const selector of args.selectors) {
    setNestedValue(spec, selector.path, selector.value);
    patched.push(selector.path);
  }

  writeYAML(args.design_path, spec);
  return textResult(JSON.stringify({ patched_paths: patched }));
}

// ── seal_design ─────────────────────────────────────────────
export function sealDesign(args: { design_path: string }): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  spec._mode = 'complete';
  if (spec.meta.generation) {
    spec.meta.generation.status = 'complete';
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];

  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({
    status: 'sealed',
    pages: spec.pages?.length ?? 0,
    layers: spec.layers?.length ?? 0,
  }));
}

// ── add_layer ───────────────────────────────────────────────
export function addLayer(args: {
  design_path: string;
  page_id?: string;
  layer: Layer;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errorResult(`Page not found: ${args.page_id}`);
    if (!page.layers) page.layers = [];
    page.layers.push(args.layer);
  } else if (spec.layers) {
    spec.layers.push(args.layer);
  } else {
    spec.layers = [args.layer];
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({ layer_id: args.layer.id }));
}

// ── update_layer ────────────────────────────────────────────
export function updateLayer(args: {
  design_path: string;
  layer_id: string;
  props: Partial<Layer>;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  let found = false;

  const updateInArray = (layers: Layer[]): Layer[] =>
    layers.map(l => {
      if (l.id === args.layer_id) {
        found = true;
        return { ...l, ...args.props } as Layer;
      }
      return l;
    });

  if (spec.layers) {
    spec.layers = updateInArray(spec.layers);
  }
  if (spec.pages) {
    for (const page of spec.pages) {
      if (page.layers) {
        page.layers = updateInArray(page.layers);
      }
    }
  }

  if (!found) return errorResult(`Layer not found: ${args.layer_id}`);

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({ updated: args.layer_id }));
}

// ── remove_layer ────────────────────────────────────────────
export function removeLayer(args: {
  design_path: string;
  layer_id: string;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);

  if (spec.layers) {
    spec.layers = spec.layers.filter(l => l.id !== args.layer_id);
  }
  if (spec.pages) {
    for (const page of spec.pages) {
      if (page.layers) {
        page.layers = page.layers.filter(l => l.id !== args.layer_id);
      }
    }
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({ removed: args.layer_id }));
}

// ── list_themes ─────────────────────────────────────────────
export function listThemes(args: { project_path: string }): ToolCallResult {
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) {
    return errorResult(`Project not found: ${projectPath}`);
  }
  const project = readYAML<{ themes: unknown[] }>(projectPath);
  return textResult(JSON.stringify(project.themes ?? []));
}

// ── export_design (returns SVG string for now) ──────────────
export function exportDesignTool(args: {
  design_path: string;
  format: string;
  output_path?: string;
  scale?: number;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  const errors = validateDesignSpec(spec);
  const criticalErrors = errors.filter(e => e.severity === 'error');

  if (criticalErrors.length > 0) {
    return errorResult(`Design has validation errors: ${criticalErrors.map(e => e.message).join(', ')}`);
  }

  // For SVG/HTML export, we can generate server-side
  // For PNG/PDF, Puppeteer would be needed (future)
  if (args.format === 'svg' || args.format === 'html') {
    const outputPath = args.output_path ?? args.design_path.replace('.design.yaml', `.${args.format}`);
    return textResult(JSON.stringify({ format: args.format, output_path: outputPath, status: 'queued' }));
  }

  return textResult(JSON.stringify({ format: args.format, status: 'requires_puppeteer', message: 'PNG/PDF export requires Puppeteer (future)' }));
}

// ── batch_create ────────────────────────────────────────────
export function batchCreate(args: {
  project_path: string;
  template_id: string;
  slots_array: Record<string, unknown>[];
}): ToolCallResult {
  const created: { design_id: string; path: string }[] = [];

  for (let i = 0; i < args.slots_array.length; i++) {
    const slots = args.slots_array[i];
    const name = (slots['name'] as string | undefined) ?? `${args.template_id}-${i + 1}`;
    const result = createDesign({
      project_path: args.project_path,
      name,
      type: 'poster',
    });

    if (result.isError) {
      return errorResult(`Failed to create design ${i + 1}: ${result.content[0]?.text}`);
    }

    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { design_id: string; path: string };

    // Patch slots into the design
    if (Object.keys(slots).length > 0) {
      const selectors = Object.entries(slots)
        .filter(([k]) => k !== 'name')
        .map(([k, v]) => ({ path: k, value: v }));

      if (selectors.length > 0) {
        patchDesign({ design_path: parsed.path, selectors });
      }
    }

    created.push({ design_id: parsed.design_id, path: parsed.path });
  }

  return textResult(JSON.stringify({ created, count: created.length }));
}

// ── duplicate_design ────────────────────────────────────────
export function duplicateDesign(args: {
  design_path: string;
  new_name: string;
  project_path?: string;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  const newId = args.new_name.toLowerCase().replace(/\s+/g, '-');
  const dir = path.dirname(args.design_path);
  const newPath = path.join(dir, `${newId}.design.yaml`);

  if (fs.existsSync(newPath)) {
    return errorResult(`Design already exists: ${newPath}`);
  }

  spec.meta.id = generateId();
  spec.meta.name = args.new_name;
  spec.meta.created = new Date().toISOString().split('T')[0];
  spec.meta.modified = new Date().toISOString().split('T')[0];

  writeYAML(newPath, spec);

  // Register in project.yaml if project_path provided
  if (args.project_path) {
    const projectPath = path.join(args.project_path, 'project.yaml');
    if (fs.existsSync(projectPath)) {
      const project = readYAML<{ designs: unknown[] }>(projectPath);
      project.designs = project.designs ?? [];
      project.designs.push({
        id: newId,
        path: `designs/${newId}.design.yaml`,
        type: spec.meta.type,
        status: 'draft',
      });
      writeYAML(projectPath, project);
    }
  }

  return textResult(JSON.stringify({ design_id: spec.meta.id, path: newPath }));
}

// ── resume_design ───────────────────────────────────────────
export function resumeDesign(args: { design_path: string }): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);

  if (spec._mode === 'complete') {
    return textResult(JSON.stringify({
      status: 'complete',
      message: 'Design is already sealed. Use patch_design to make changes.',
    }));
  }

  const gen = spec.meta.generation;
  const completedPages = gen?.completed_pages ?? 0;
  const totalPages = gen?.total_pages ?? 0;
  const remaining = Math.max(0, totalPages - completedPages);

  const existingPageIds = (spec.pages ?? []).map((p: Page) => p.id);

  return textResult(JSON.stringify({
    status: 'in_progress',
    design_id: spec.meta.id,
    design_path: args.design_path,
    theme: spec.theme,
    document: spec.document,
    completed_pages: completedPages,
    total_pages: totalPages,
    remaining_pages: remaining,
    existing_page_ids: existingPageIds,
    last_operation: gen?.last_operation ?? null,
    context: `Design "${spec.meta.name}" is in progress. ${completedPages}/${totalPages} pages done. Resume by calling append_page for pages ${completedPages + 1} to ${totalPages}, then seal_design.`,
  }));
}

// ── save_as_component ────────────────────────────────────────
export function saveAsComponent(args: {
  design_path: string;
  layer_ids: string[];
  component_name: string;
  project_path: string;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  const allLayers = spec.layers ?? [];

  const extracted = allLayers.filter(l => args.layer_ids.includes(l.id));
  if (extracted.length === 0) {
    return errorResult(`No matching layers found for IDs: ${args.layer_ids.join(', ')}`);
  }

  const componentId = args.component_name.toLowerCase().replace(/\s+/g, '-');
  const componentPath = path.join(args.project_path, `components/${componentId}.component.yaml`);

  const component = {
    _protocol: 'component/v1',
    name: args.component_name,
    id: componentId,
    version: '1.0.0',
    props: {},
    layers: extracted,
  };

  writeYAML(componentPath, component);

  // Update components/index.yaml
  const indexPath = path.join(args.project_path, 'components/index.yaml');
  const index = fs.existsSync(indexPath)
    ? readYAML<{ components: unknown[] }>(indexPath)
    : { components: [] };
  index.components = index.components ?? [];
  index.components.push({ id: componentId, path: `components/${componentId}.component.yaml`, name: args.component_name });
  writeYAML(indexPath, index);

  // Replace extracted layers in design with a component instance
  const remainingLayers = allLayers.filter(l => !args.layer_ids.includes(l.id));
  const firstExtracted = extracted[0];
  const componentInstance: Layer = {
    id: `${componentId}-instance`,
    type: 'component',
    z: firstExtracted.z,
    x: firstExtracted.x ?? 0,
    y: firstExtracted.y ?? 0,
    width: firstExtracted.width ?? 0,
    height: firstExtracted.height ?? 0,
    ref: componentId,
    slots: {},
  } as unknown as Layer;

  spec.layers = [...remainingLayers, componentInstance].sort((a, b) => a.z - b.z);
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return textResult(JSON.stringify({
    component_id: componentId,
    component_path: componentPath,
    layers_extracted: extracted.length,
    instance_id: componentInstance.id,
  }));
}

// ── apply_theme ─────────────────────────────────────────────
export function applyTheme(args: {
  project_path: string;
  theme_id: string;
}): ToolCallResult {
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) {
    return errorResult(`Project not found: ${projectPath}`);
  }

  const project = readYAML<{
    config: { default_theme: string };
    themes: { id: string; active: boolean }[];
    designs: unknown[];
  }>(projectPath);

  // Verify theme exists
  const themes: { id: string; active: boolean }[] = project.themes ?? [];
  const themeEntry = themes.find(t => t.id === args.theme_id);
  if (!themeEntry) {
    return errorResult(`Theme not found: ${args.theme_id}. Available: ${themes.map(t => t.id).join(', ')}`);
  }

  // Update active flags
  for (const t of themes) {
    t.active = t.id === args.theme_id;
  }
  project.config.default_theme = args.theme_id;

  writeYAML(projectPath, project);

  return textResult(JSON.stringify({
    active_theme: args.theme_id,
    affected_designs: (project.designs ?? []).length,
  }));
}

// ── export_template ─────────────────────────────────────────
export function exportTemplateTool(args: {
  design_path: string;
  output_path?: string;
}): ToolCallResult {
  if (!fs.existsSync(args.design_path)) {
    return errorResult(`Design not found: ${args.design_path}`);
  }

  const spec = readYAML<DesignSpec>(args.design_path);
  const template = exportAsTemplate(spec);

  const outPath = args.output_path ??
    args.design_path.replace(/\.design\.yaml$/, '.template.yaml').replace(/\.yaml$/, '.template.yaml');
  writeYAML(outPath, template);

  return textResult(JSON.stringify({
    template_path: outPath,
    slot_count: template.slots.length,
    slots: template.slots.map(s => ({ id: s.id, path: s.path, type: s.type, hint: s.hint })),
  }));
}

// ── inject_template ─────────────────────────────────────────
export function injectTemplateTool(args: {
  template_path: string;
  slots: Record<string, unknown>;
  output_path?: string;
}): ToolCallResult {
  if (!fs.existsSync(args.template_path)) {
    return errorResult(`Template not found: ${args.template_path}`);
  }

  const template = readYAML<TemplateSpec>(args.template_path);
  if (template._protocol !== 'template/v1') {
    return errorResult(`File is not a template (expected _protocol: template/v1)`);
  }

  const design = injectIntoTemplate(template, args.slots);
  design.meta.modified = new Date().toISOString().split('T')[0];

  const outPath = args.output_path ??
    args.template_path.replace(/\.template\.yaml$/, `.${Date.now().toString(36)}.design.yaml`);
  writeYAML(outPath, design);

  return textResult(JSON.stringify({
    design_path: outPath,
    slots_injected: Object.keys(args.slots).length,
  }));
}

// ── list_template_slots ──────────────────────────────────────
export function listTemplateSlots(args: { template_path: string }): ToolCallResult {
  if (!fs.existsSync(args.template_path)) {
    return errorResult(`Template not found: ${args.template_path}`);
  }

  const template = readYAML<TemplateSpec>(args.template_path);
  if (template._protocol !== 'template/v1') {
    return errorResult(`File is not a template (expected _protocol: template/v1)`);
  }

  const slots = listSlots(template);
  return textResult(JSON.stringify({ slots, count: slots.length }));
}

// ── Utilities ───────────────────────────────────────────────
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  // Handle array index notation: pages[id=page_1].slots.title
  const parts = dotPath.split('.');
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(\w+)\[(\w+)=([^\]]+)\]$/);

    if (arrayMatch) {
      const [, arrayKey, filterKey, filterValue] = arrayMatch;
      const arr = (current as Record<string, unknown>)[arrayKey];
      if (Array.isArray(arr)) {
        current = arr.find((item: Record<string, unknown>) => String(item[filterKey]) === filterValue);
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined || current === null) return;
  }

  (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
}
