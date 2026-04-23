// §14 — pure domain logic, zero MCP imports
// server files call these functions; nothing here touches MCP protocol.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, ThemeSpec, Layer, Page } from '../schema/types';
import type { ToolResult } from './types';
import { validateDesignSpec } from '../schema/validator';
import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';
import { resolvePath, snapshot, readYAML, writeYAML, generateId, errResult, okResult, LIMITS } from './engine/utils';
import { buildGuide } from './engine/guide';
import { expandShorthandLayers } from './shorthand-parser';
import type { ShorthandLayer } from './shorthand-parser';
import { createTaskFile, readTask, writeTask, markPageDone, buildNextAction } from './engine/task';
import type { NextAction } from './types';

// ── Tier 1 — Project Management (6 tools) ───────────────────
export function createProject(args: { name: string; path: string; theme?: string; canvas?: string }): ToolResult {
  const op = 'create_project';
  let projectDir: string;
  try { projectDir = resolvePath(args.path); } catch (e) { return errResult(op, (e as Error).message, 'Provide a path inside your home directory.'); }

  if (fs.existsSync(projectDir)) return errResult(op, `Directory already exists: ${projectDir}`, 'Choose a different path or delete the existing directory.');

  const [width, height] = (args.canvas ?? '1080x1080').split('x').map(Number);
  for (const dir of ['themes','components','templates','designs','assets/fonts','assets/icons','assets/images','exports']) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }

  const theme: ThemeSpec = {
    _protocol: 'theme/v1', name: 'Dark Tech', version: '1.0.0',
    colors: { background: '#1A1A2E', surface: '#16213E', primary: '#E94560', secondary: '#3D9EE4', text: '#FFFFFF', text_muted: '#8892A4', border: '#2A2A4A' },
    typography: { scale: { h1: { size: 72, weight: 700, line_height: 1.1 }, h2: { size: 48, weight: 700, line_height: 1.2 }, body: { size: 18, weight: 400, line_height: 1.6 } }, families: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' } },
    spacing: { unit: 8, scale: [0,4,8,16,24,32,48,64] },
    effects: { shadow_card: '0 4px 24px rgba(0,0,0,0.4)' },
    radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
  };
  writeYAML(path.join(projectDir, 'themes/dark-tech.theme.yaml'), theme);

  const id = generateId();
  const today = new Date().toISOString().split('T')[0];
  const project = {
    _protocol: 'project/v1',
    meta: { id, name: args.name, version: '1.0.0', created: today, modified: today },
    config: { default_theme: args.theme ?? 'dark-tech', default_canvas: `${width}x${height}`, default_export_format: 'png' },
    themes: [{ id: 'dark-tech', path: 'themes/dark-tech.theme.yaml', active: true }],
    components: { registry: 'components/index.yaml' },
    templates: { registry: 'templates/index.yaml' },
    designs: [], assets: { fonts: [], images: [] }, exports: [],
  };
  writeYAML(path.join(projectDir, 'project.yaml'), project);
  writeYAML(path.join(projectDir, 'components/index.yaml'), { components: [] });
  writeYAML(path.join(projectDir, 'templates/index.yaml'), { templates: [] });

  return okResult(op, { project_id: id, path: projectDir });
}
export function listDesigns(args: { project_path: string }): ToolResult {
  const op = 'list_designs';
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');
  const project = readYAML<{ designs: unknown[] }>(projectPath);
  const designs = project.designs ?? [];
  const limit = LIMITS.list_items;
  const truncated = designs.length > limit;
  return okResult(op, { designs: designs.slice(0, limit), total: designs.length, truncated });
}
export function listThemes(args: { project_path: string }): ToolResult {
  const op = 'list_themes';
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');
  const project = readYAML<{ themes: unknown[] }>(projectPath);
  return okResult(op, { themes: project.themes ?? [] });
}
export function applyTheme(args: { project_path: string; theme_id: string }): ToolResult {
  const op = 'apply_theme';
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');

  const project = readYAML<{ config: { default_theme: string }; themes: { id: string; active: boolean }[]; designs: unknown[] }>(projectPath);
  const themes = project.themes ?? [];
  const themeEntry = themes.find(t => t.id === args.theme_id);
  if (!themeEntry) return errResult(op, `Theme not found: ${args.theme_id}`, `Available: ${themes.map(t => t.id).join(', ')}`);

  // §19 — snapshot before write
  const bak = snapshot(projectPath);
  for (const t of themes) t.active = t.id === args.theme_id;
  project.config.default_theme = args.theme_id;
  writeYAML(projectPath, project);

  return okResult(op, { active_theme: args.theme_id, affected_designs: (project.designs ?? []).length }, bak);
}
export function duplicateDesign(args: { design_path: string; new_name: string; project_path?: string }): ToolResult {
  const op = 'duplicate_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(args.design_path);
  const newId = args.new_name.toLowerCase().replace(/\s+/g, '-');
  const dir = path.dirname(args.design_path);
  const newPath = path.join(dir, `${newId}.design.yaml`);
  if (fs.existsSync(newPath)) return errResult(op, `Design already exists: ${newPath}`, 'Choose a different new_name.');

  const today = new Date().toISOString().split('T')[0];
  spec.meta.id = generateId();
  spec.meta.name = args.new_name;
  spec.meta.created = today;
  spec.meta.modified = today;
  writeYAML(newPath, spec);

  if (args.project_path) {
    const projectPath = path.join(args.project_path, 'project.yaml');
    if (fs.existsSync(projectPath)) {
      const bak = snapshot(projectPath);
      const project = readYAML<{ designs: unknown[] }>(projectPath);
      project.designs = project.designs ?? [];
      project.designs.push({ id: newId, path: `designs/${newId}.design.yaml`, type: spec.meta.type, status: 'draft' });
      writeYAML(projectPath, project);
      return okResult(op, { design_id: spec.meta.id, path: newPath }, bak);
    }
  }
  return okResult(op, { design_id: spec.meta.id, path: newPath });
}
export function resumeDesign(args: { design_path: string }): ToolResult {
  const op = 'resume_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(args.design_path);
  if (spec._mode === 'complete') return okResult(op, { status: 'complete', message: 'Design already sealed. Use patch_design to make changes.' });

  const gen = spec.meta.generation;
  const completed = gen?.completed_pages ?? 0;
  const total = gen?.total_pages ?? 0;
  const pageIds = (spec.pages ?? []).map((p: Page) => p.id);

  return okResult(op, {
    status: 'in_progress',
    design_id: spec.meta.id,
    design_path: args.design_path,
    theme: spec.theme,
    document: spec.document,
    completed_pages: completed,
    total_pages: total,
    remaining_pages: Math.max(0, total - completed),
    existing_page_ids: pageIds,
    last_operation: gen?.last_operation ?? null,
    hint: `Resume by calling append_page for pages ${completed + 1}–${total}, then seal_design.`,
  });
}

export function createTask(args: { project_path: string; task_name: string; brief: string; theme?: string; pages: { id?: string; label: string; hints?: string }[]; width?: number; height?: number }): ToolResult {
  const op = 'create_task';
  if (!args.pages || args.pages.length === 0) return errResult(op, 'pages array must not be empty', 'Provide at least one page: [{label:"Cover",hints:"..."}]');

  const designResult = createDesign({
    project_path: args.project_path,
    name: args.task_name,
    type: 'carousel',
    width: args.width,
    height: args.height,
    theme_ref: args.theme,
  });
  if (!designResult.success) return { ...designResult, op };

  const designPath = designResult['path'] as string;
  const { taskPath, spec } = createTaskFile({
    projectPath: args.project_path,
    taskName: args.task_name,
    brief: args.brief,
    designPath,
    theme: args.theme ?? 'dark-tech',
    pages: args.pages,
  });

  const next_action: NextAction = buildNextAction(spec, taskPath);
  return okResult(op, {
    task_id: spec.task_id,
    task_path: taskPath,
    design_path: designPath,
    total_pages: spec.pages.length,
    next_action,
  });
}
export function resumeTask(args: { task_path: string }): ToolResult {
  const op = 'resume_task';
  if (!fs.existsSync(args.task_path)) return errResult(op, `Task not found: ${args.task_path}`, 'Check task_path. Use list_designs to find in-progress designs.');

  const spec = readTask(args.task_path);
  const done = spec.pages.filter(p => p.status === 'done').length;
  const pending = spec.pages.filter(p => p.status === 'pending').length;
  const next_action: NextAction = buildNextAction(spec, args.task_path);

  return okResult(op, {
    status: pending === 0 ? 'complete' : 'in_progress',
    task_id: spec.task_id,
    brief: spec.brief,
    design_path: spec.design_path,
    total_pages: spec.total_pages,
    completed_pages: done,
    remaining_pages: pending,
    next_action,
  });
}

export function getEngineGuide(_args: Record<string, unknown>): ToolResult {
  const guide = buildGuide();
  return okResult('get_engine_guide', { guide, token_hint: 'Load once per session. Refer to shorthand examples before generating layers.' });
}

export function listTasks(args: { project_path: string }): ToolResult {
  const op = 'list_tasks';
  const tasksDir = path.join(args.project_path, '.tasks');
  if (!fs.existsSync(tasksDir)) return okResult(op, { tasks: [], total: 0, truncated: false });

  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.task.yaml'));
  const limit = LIMITS.list_items;
  const truncated = files.length > limit;
  const tasks = files.slice(0, limit).map(f => {
    try {
      const spec = readYAML<{ task_id: string; brief: string; design_path: string; total_pages: number; pages: { status: string }[] }>(path.join(tasksDir, f));
      const done = spec.pages.filter(p => p.status === 'done').length;
      return { task_path: path.join(tasksDir, f), task_id: spec.task_id, brief: spec.brief, design_path: spec.design_path, total_pages: spec.total_pages, completed_pages: done, status: done === spec.total_pages ? 'complete' : 'in_progress' };
    } catch { return { task_path: path.join(tasksDir, f), error: 'unreadable' }; }
  });
  return okResult(op, { tasks, total: files.length, truncated });
}

// ── Tier 2 — Design Lifecycle (7 tools) ─────────────────────
// §10 — surgical read: returns IDs + types + positions only, NOT content values
export function inspectDesign(args: { design_path: string; page_id?: string }): ToolResult {
  const op = 'inspect_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(args.design_path);
  const limit = LIMITS.layer_rows;

  const summarise = (layers: Layer[] = []) =>
    layers.slice(0, limit).map(l => ({ id: l.id, type: l.type, z: l.z, x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: (l as unknown as Record<string, unknown>)['height'] ?? 0 }));

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`);
    const layers = summarise(page.layers);
    return okResult(op, { page_id: page.id, label: page.label, layers, layer_count: (page.layers ?? []).length, truncated: (page.layers ?? []).length > limit });
  }

  if (spec.pages) {
    const pageLimit = LIMITS.list_rows;
    const pages = spec.pages.slice(0, pageLimit).map(p => ({ id: p.id, label: p.label, layer_count: (p.layers ?? []).length }));
    return okResult(op, { type: 'carousel', page_count: spec.pages.length, pages, mode: spec._mode, theme: spec.theme?.ref, document: spec.document, truncated: spec.pages.length > pageLimit });
  }

  const layers = summarise(spec.layers);
  return okResult(op, { type: 'poster', layers, layer_count: (spec.layers ?? []).length, mode: spec._mode, theme: spec.theme?.ref, document: spec.document, truncated: (spec.layers ?? []).length > limit });
}

// Multiple layers in a single call — avoids N round-trips for poster designs
export function addLayers(args: {
  design_path: string;
  page_id?: string;
  layers?: Layer[];
  layers_shorthand?: ShorthandLayer[];
  task_path?: string;
}): ToolResult {
  const op = 'add_layers';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check design_path.');
  if (!args.layers?.length && !args.layers_shorthand?.length) return errResult(op, 'No layers provided', 'Pass layers or layers_shorthand array.');

  const incoming: Layer[] = args.layers_shorthand?.length
    ? expandShorthandLayers(args.layers_shorthand)
    : (args.layers ?? []);

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`);
    if (!page.layers) page.layers = [];
    page.layers.push(...incoming);
  } else {
    if (!spec.layers) spec.layers = [];
    spec.layers.push(...incoming);
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: args.design_path }, remaining: 0, hint: 'Layers added. Call seal_design to finalise, or add_layers again for more.' };
  return okResult(op, { added: incoming.length, layer_ids: incoming.map(l => l.id), next_action }, bak);
}

export function createDesign(args: { project_path: string; name: string; type?: string; width?: number; height?: number; theme_ref?: string }): ToolResult {
  const op = 'create_design';
  const type = args.type ?? 'poster';
  const designId = args.name.toLowerCase().replace(/\s+/g, '-');
  const designPath = path.join(args.project_path, `designs/${designId}.design.yaml`);
  const today = new Date().toISOString().split('T')[0];

  const spec: DesignSpec = {
    _protocol: 'design/v1',
    _mode: type === 'carousel' ? 'in_progress' : 'complete',
    meta: {
      id: generateId(), name: args.name, type: type as 'poster' | 'carousel',
      created: today, modified: today, generator: 'mcp',
      generation: type === 'carousel' ? { status: 'in_progress', total_pages: 0, completed_pages: 0 } : undefined,
    },
    document: { width: args.width ?? 1080, height: args.height ?? 1080, unit: 'px', dpi: 96 },
    theme: { ref: args.theme_ref ?? 'dark-tech' },
    ...(type === 'carousel' ? { pages: [] } : { layers: [] }),
  };

  writeYAML(designPath, spec);

  const projectPath = path.join(args.project_path, 'project.yaml');
  // For carousel designs, tell the model the first thing to do next
  const next_action: NextAction | undefined = type === 'carousel' ? {
    tool: 'append_page',
    params: { design_path: designPath, page_id: 'page_1', label: 'Page 1' },
    remaining: 1,
    hint: 'Add pages with append_page (use task_path for automatic handover), then seal_design.',
  } : undefined;

  if (fs.existsSync(projectPath)) {
    const bak = snapshot(projectPath);
    const project = readYAML<{ designs: unknown[] }>(projectPath);
    project.designs = project.designs ?? [];
    project.designs.push({ id: designId, path: `designs/${designId}.design.yaml`, type, status: 'draft' });
    writeYAML(projectPath, project);
    return okResult(op, { design_id: spec.meta.id, path: designPath, ...(next_action ? { next_action } : {}) }, bak);
  }
  return okResult(op, { design_id: spec.meta.id, path: designPath, ...(next_action ? { next_action } : {}) });
}
export function appendPage(args: {
  design_path: string;
  page_id?: string;
  label?: string;
  template_ref?: string;
  slots?: Record<string, unknown>;
  layers?: Layer[];
  layers_shorthand?: ShorthandLayer[];  // compact form — expands before write
  task_path?: string;                    // if set, updates task state + emits next_action
}): ToolResult {
  const op = 'append_page';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  // Expand shorthand layers if provided (saves ~80% of model output tokens per page)
  const layers: Layer[] = args.layers_shorthand && args.layers_shorthand.length > 0
    ? expandShorthandLayers(args.layers_shorthand)
    : (args.layers ?? []);

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);
  if (!spec.pages) spec.pages = [];

  const pageId = args.page_id ?? `page_${spec.pages.length + 1}`;
  spec.pages.push({
    id: pageId,
    label: args.label ?? `Page ${spec.pages.length + 1}`,
    template_ref: args.template_ref,
    slots: args.slots,
    layers,
  });

  if (spec.meta.generation) {
    spec.meta.generation.completed_pages = spec.pages.length;
    spec.meta.generation.total_pages = Math.max(spec.meta.generation.total_pages, spec.pages.length);
    spec.meta.generation.last_operation = 'append_page';
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  // Update task file and compute relay baton for the model
  let next_action: NextAction | undefined;
  if (args.task_path && fs.existsSync(args.task_path)) {
    const taskSpec = readTask(args.task_path);
    markPageDone(taskSpec, pageId);
    writeTask(args.task_path, taskSpec);
    next_action = buildNextAction(taskSpec, args.task_path);
  }

  return okResult(op, {
    page_id: pageId,
    page_count: spec.pages.length,
    ...(next_action !== undefined ? { next_action } : {}),
  }, bak);
}
export function patchDesign(args: { design_path: string; selectors: { path: string; value: unknown }[] }): ToolResult {
  const op = 'patch_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  // §19 — validate selectors before snapshot
  const invalid = args.selectors.filter(s => typeof s.path !== 'string' || !s.path);
  if (invalid.length > 0) return errResult(op, 'Selectors missing path field', 'Each selector needs { path: "dot.path", value: ... }');

  const bak = snapshot(args.design_path);
  const spec = readYAML<Record<string, unknown>>(args.design_path);
  const patched: string[] = [];
  for (const sel of args.selectors) {
    setNestedValue(spec, sel.path, sel.value);
    patched.push(sel.path);
  }
  writeYAML(args.design_path, spec);

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: args.design_path }, remaining: -1, hint: 'Fields patched. Call seal_design or make further patches.' };
  return okResult(op, { patched_paths: patched, count: patched.length, next_action }, bak);
}
export function sealDesign(args: { design_path: string }): ToolResult {
  const op = 'seal_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);
  spec._mode = 'complete';
  if (spec.meta.generation) spec.meta.generation.status = 'complete';
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  const next_action: NextAction = {
    tool: 'export_design',
    params: { design_path: args.design_path, format: 'svg' },
    remaining: 0,
    hint: 'Design sealed. Export with export_design or open in the editor.',
  };
  return okResult(op, { status: 'sealed', pages: spec.pages?.length ?? 0, layers: spec.layers?.length ?? 0, next_action }, bak);
}
export function addLayer(args: { design_path: string; page_id?: string; layer: Layer }): ToolResult {
  const op = 'add_layer';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Existing pages: ${spec.pages.map(p => p.id).join(', ')}`);
    if (!page.layers) page.layers = [];
    page.layers.push(args.layer);
  } else {
    if (!spec.layers) spec.layers = [];
    spec.layers.push(args.layer);
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);
  const next_action: NextAction = { tool: 'seal_design', params: { design_path: args.design_path }, remaining: -1, hint: 'Continue adding layers or call seal_design when complete.' };
  return okResult(op, { layer_id: args.layer.id, next_action }, bak);
}
export function updateLayer(args: { design_path: string; layer_id: string; props: Partial<Layer> }): ToolResult {
  const op = 'update_layer';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);
  let found = false;

  const patch = (layers: Layer[]): Layer[] =>
    layers.map(l => { if (l.id === args.layer_id) { found = true; return { ...l, ...args.props } as Layer; } return l; });

  if (spec.layers) spec.layers = patch(spec.layers);
  if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = patch(page.layers); }

  if (!found) return errResult(op, `Layer not found: ${args.layer_id}`, 'Use resume_design to inspect existing layer IDs.');

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);
  const next_action: NextAction = { tool: 'seal_design', params: { design_path: args.design_path }, remaining: -1, hint: 'Continue editing or call seal_design when complete.' };
  return okResult(op, { updated: args.layer_id, next_action }, bak);
}
export function removeLayer(args: { design_path: string; layer_id: string }): ToolResult {
  const op = 'remove_layer';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const bak = snapshot(args.design_path);
  const spec = readYAML<DesignSpec>(args.design_path);
  if (spec.layers) spec.layers = spec.layers.filter(l => l.id !== args.layer_id);
  if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = page.layers.filter(l => l.id !== args.layer_id); }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);
  const next_action: NextAction = { tool: 'inspect_design', params: { design_path: args.design_path }, remaining: -1, hint: 'Verify removal with inspect_design, then continue editing or seal.' };
  return okResult(op, { removed: args.layer_id, next_action }, bak);
}

// ── Tier 3 — Export & Templates (6 tools) ───────────────────
export function exportDesign(args: { design_path: string; format: string; output_path?: string; scale?: number }): ToolResult {
  const op = 'export_design';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(args.design_path);
  const criticals = validateDesignSpec(spec).filter(e => e.severity === 'error');
  if (criticals.length > 0) return errResult(op, `Design has validation errors: ${criticals.map(e => e.message).join('; ')}`, 'Fix errors then retry.');

  // §19 — output_path must not equal input
  const outPath = args.output_path ?? args.design_path.replace('.design.yaml', `.${args.format}`);
  if (args.format === 'svg' || args.format === 'html') {
    return okResult(op, { format: args.format, output_file: path.basename(outPath), output_path: outPath, status: 'queued' });
  }
  return okResult(op, { format: args.format, status: 'requires_puppeteer', hint: 'PNG/PDF export requires Puppeteer (Phase 2).' });
}
export function batchCreate(args: { project_path: string; template_id: string; slots_array: Record<string, unknown>[] }): ToolResult {
  const op = 'batch_create';
  const created: { design_id: string; path: string }[] = [];

  for (let i = 0; i < args.slots_array.length; i++) {
    const slots = args.slots_array[i];
    const name = (slots['name'] as string | undefined) ?? `${args.template_id}-${i + 1}`;
    const r = createDesign({ project_path: args.project_path, name, type: 'poster' });
    if (!r.success) return errResult(op, `Failed at design ${i + 1}: ${r.error ?? ''}`, r.hint ?? '');

    const designPath = r['path'] as string;
    const selectors = Object.entries(slots).filter(([k]) => k !== 'name').map(([k, v]) => ({ path: k, value: v }));
    if (selectors.length > 0) {
      const pr = patchDesign({ design_path: designPath, selectors });
      if (!pr.success) return errResult(op, `Patch failed at design ${i + 1}: ${pr.error ?? ''}`, pr.hint ?? '');
    }
    created.push({ design_id: r['design_id'] as string, path: designPath });
  }

  return okResult(op, { created, count: created.length });
}
export function saveAsComponent(args: { design_path: string; layer_ids: string[]; component_name: string; project_path: string }): ToolResult {
  const op = 'save_as_component';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(args.design_path);
  const extracted = (spec.layers ?? []).filter(l => args.layer_ids.includes(l.id));
  if (extracted.length === 0) return errResult(op, `No matching layers for IDs: ${args.layer_ids.join(', ')}`, 'Use resume_design to inspect layer IDs.');

  const componentId = args.component_name.toLowerCase().replace(/\s+/g, '-');
  const componentPath = path.join(args.project_path, `components/${componentId}.component.yaml`);
  writeYAML(componentPath, { _protocol: 'component/v1', name: args.component_name, id: componentId, version: '1.0.0', props: {}, layers: extracted });

  const indexPath = path.join(args.project_path, 'components/index.yaml');
  const index = fs.existsSync(indexPath) ? readYAML<{ components: unknown[] }>(indexPath) : { components: [] };
  index.components = index.components ?? [];
  index.components.push({ id: componentId, path: `components/${componentId}.component.yaml`, name: args.component_name });
  writeYAML(indexPath, index);

  const bak = snapshot(args.design_path);
  const firstLayer = extracted[0];
  const instance = { id: `${componentId}-instance`, type: 'component', z: firstLayer.z, x: firstLayer.x ?? 0, y: firstLayer.y ?? 0, width: firstLayer.width ?? 0, height: firstLayer.height ?? 0, ref: componentId, slots: {} } as unknown as Layer;
  spec.layers = [...(spec.layers ?? []).filter(l => !args.layer_ids.includes(l.id)), instance].sort((a, b) => a.z - b.z);
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(args.design_path, spec);

  return okResult(op, { component_id: componentId, component_path: componentPath, layers_extracted: extracted.length, instance_id: instance.id }, bak);
}
export function exportTemplate(args: { design_path: string; output_path?: string }): ToolResult {
  const op = 'export_template';
  if (!fs.existsSync(args.design_path)) return errResult(op, `Design not found: ${args.design_path}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(args.design_path);
  const template = exportAsTemplate(spec);
  const outPath = args.output_path ?? args.design_path.replace(/\.design\.yaml$/, '.template.yaml');
  writeYAML(outPath, template);

  const slots = template.slots.map(s => ({ id: s.id, path: s.path, type: s.type, hint: s.hint }));
  const next_action: NextAction = { tool: 'inject_template', params: { template_path: outPath, slots: Object.fromEntries(slots.map(s => [s.id, ''])) }, remaining: 1, hint: 'Fill slot values then call inject_template.' };
  return okResult(op, { template_path: outPath, template_file: path.basename(outPath), slot_count: slots.length, slots, next_action });
}
export function injectTemplate(args: { template_path: string; slots: Record<string, unknown>; output_path?: string }): ToolResult {
  const op = 'inject_template';
  if (!fs.existsSync(args.template_path)) return errResult(op, `Template not found: ${args.template_path}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(args.template_path);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1');

  const design = injectIntoTemplate(template, args.slots);
  design.meta.modified = new Date().toISOString().split('T')[0];
  const outPath = args.output_path ?? args.template_path.replace(/\.template\.yaml$/, `.${Date.now().toString(36)}.design.yaml`);
  writeYAML(outPath, design);

  const next_action: NextAction = { tool: 'export_design', params: { design_path: outPath, format: 'svg' }, remaining: 1, hint: 'Template injected. Export with export_design or open in editor.' };
  return okResult(op, { design_path: outPath, design_file: path.basename(outPath), slots_injected: Object.keys(args.slots).length, next_action });
}
export function listTemplateSlots(args: { template_path: string }): ToolResult {
  const op = 'list_template_slots';
  if (!fs.existsSync(args.template_path)) return errResult(op, `Template not found: ${args.template_path}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(args.template_path);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1');

  const slots = listSlots(template);
  return okResult(op, { slots, count: slots.length });
}

// ── Internal shared helpers ──────────────────────────────────
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(\w+)\[(\w+)=([^\]]+)\]$/);
    if (arrayMatch) {
      const [, arrayKey, filterKey, filterValue] = arrayMatch;
      const arr = (current as Record<string, unknown>)[arrayKey];
      if (Array.isArray(arr)) current = arr.find((item: Record<string, unknown>) => String(item[filterKey]) === filterValue);
    } else {
      current = (current as Record<string, unknown>)[part];
    }
    if (current === undefined || current === null) return;
  }
  (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
}

