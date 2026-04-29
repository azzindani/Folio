// §14 — pure domain logic, zero MCP imports
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, ThemeSpec, Layer, Page } from '../schema/types';
import type { ToolResult } from './types';
import type { ProgressItem } from './types';
import { validateDesignSpec } from '../schema/validator';
import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';
import {
  resolvePath, resolveDesignPath, snapshot, readYAML, writeYAML,
  generateId, errResult, okResult, LIMITS,
  pOk, pWarn, pInfo,
  buildContext, buildHandover,
} from './engine/utils';
import { buildGuide } from './engine/guide';
import { renderToSVGString } from './engine/svg-export';
import { expandShorthandLayers } from './shorthand-parser';
import type { ShorthandLayer } from './shorthand-parser';
import { createTaskFile, readTask, writeTask, markPageDone, buildNextAction } from './engine/task';
import type { NextAction } from './types';
import { assembleReportHTML } from '../export/html-assembler';
import { assemblePresentationHTML } from '../export/presentation-assembler';
import type { LoadedDataset } from '../report/data-loader';
import { evaluateFormula, isFormula } from '../scripting/formula';
import type { FormulaContext } from '../scripting/formula';
import { buildTimelineTracks, renderTimelineASCII, addKeyframe } from '../ui/panels/timeline-panel';
import type { Keyframe } from '../animation/types';
import { getClientScript } from '../export/remote-server';
import { tryFfmpeg } from '../export/animation-export';

// ── Tier 2 forward-declaration (createDesign called by createTask) ──
export function createDesign(args: { project_path: string; name: string; type?: string; width?: number; height?: number; theme_ref?: string }): ToolResult {
  const op = 'create_design';
  const progress: ProgressItem[] = [];
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
  progress.push(pOk(`Created ${type} scaffold`, path.basename(designPath)));

  const projectPath = path.join(args.project_path, 'project.yaml');
  const next_action: NextAction | undefined = type === 'carousel' ? {
    tool: 'append_page', params: { design_path: designPath, page_id: 'page_1', label: 'Page 1' },
    remaining: 1, hint: 'Add pages with append_page, then seal_design.',
  } : undefined;

  if (fs.existsSync(projectPath)) {
    const bak = snapshot(projectPath);
    progress.push(pInfo('Snapshot created', path.basename(bak)));
    const project = readYAML<{ designs: unknown[] }>(projectPath);
    project.designs = project.designs ?? [];
    project.designs.push({ id: designId, path: `designs/${designId}.design.yaml`, type, status: 'draft' });
    writeYAML(projectPath, project);
    progress.push(pOk('Registered in project.yaml'));
    const context = buildContext(op, `Created ${type} design "${args.name}"`, [
      { type: 'design', path: designPath, role: 'created' },
    ]);
    const handover = buildHandover('DESIGN', { design_path: designPath, project_path: args.project_path });
    return okResult(op, { design_id: spec.meta.id, path: designPath, ...(next_action ? { next_action } : {}), progress, context, handover }, bak);
  }
  const context = buildContext(op, `Created ${type} design "${args.name}"`, [
    { type: 'design', path: designPath, role: 'created' },
  ]);
  const handover = buildHandover('DESIGN', { design_path: designPath, project_path: args.project_path });
  return okResult(op, { design_id: spec.meta.id, path: designPath, ...(next_action ? { next_action } : {}), progress, context, handover });
}

// ── Tier 1 — Project Management ──────────────────────────────

export function createProject(args: { name: string; path: string; theme?: string; canvas?: string }): ToolResult {
  const op = 'create_project';
  const progress: ProgressItem[] = [];
  let projectDir: string;
  try { projectDir = resolvePath(args.path); } catch (e) {
    return errResult(op, (e as Error).message, 'Provide a path inside your home directory.');
  }
  if (fs.existsSync(projectDir)) {
    return errResult(op, `Directory already exists: ${projectDir}`, 'Choose a different path or delete the existing directory.', progress);
  }

  const [width, height] = (args.canvas ?? '1080x1080').split('x').map(Number);
  for (const dir of ['themes','components','templates','designs','assets/fonts','assets/icons','assets/images','exports']) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
  progress.push(pOk('Created project directories', projectDir));

  const theme: ThemeSpec = {
    _protocol: 'theme/v1', name: 'Dark Tech', version: '1.0.0',
    colors: { background: '#1A1A2E', surface: '#16213E', primary: '#E94560', secondary: '#3D9EE4', text: '#FFFFFF', text_muted: '#8892A4', border: '#2A2A4A' },
    typography: { scale: { h1: { size: 72, weight: 700, line_height: 1.1 }, h2: { size: 48, weight: 700, line_height: 1.2 }, body: { size: 18, weight: 400, line_height: 1.6 } }, families: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' } },
    spacing: { unit: 8, scale: [0,4,8,16,24,32,48,64] },
    effects: { shadow_card: '0 4px 24px rgba(0,0,0,0.4)' },
    radii: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
  };
  writeYAML(path.join(projectDir, 'themes/dark-tech.theme.yaml'), theme);
  progress.push(pInfo('Wrote default theme', 'dark-tech.theme.yaml'));

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
  progress.push(pOk('Wrote project.yaml', `canvas ${width}×${height}`));

  const context = buildContext(op, `Created project "${args.name}" at ${projectDir}`, [
    { type: 'project', path: projectDir, role: 'created' },
  ]);
  const handover = buildHandover('PROJECT', { project_path: projectDir });
  return okResult(op, { project_id: id, path: projectDir, progress, context, handover });
}

export function listDesigns(args: { project_path: string }): ToolResult {
  const op = 'list_designs';
  const progress: ProgressItem[] = [];
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');
  const project = readYAML<{ designs: unknown[] }>(projectPath);
  const designs = project.designs ?? [];
  const limit = LIMITS.list_items;
  const truncated = designs.length > limit;
  progress.push(pOk(`Listed ${Math.min(designs.length, limit)} design(s)`, truncated ? `truncated at ${limit}` : ''));
  const context = buildContext(op, `Found ${designs.length} design(s) in project`);
  const handover = buildHandover('PROJECT', { project_path: args.project_path });
  return okResult(op, { designs: designs.slice(0, limit), total: designs.length, truncated, progress, context, handover });
}

export function listThemes(args: { project_path: string }): ToolResult {
  const op = 'list_themes';
  const progress: ProgressItem[] = [];
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');
  const project = readYAML<{ themes: unknown[] }>(projectPath);
  const themes = project.themes ?? [];
  progress.push(pOk(`Found ${themes.length} theme(s)`));
  const context = buildContext(op, `Listed ${themes.length} theme(s)`);
  const handover = buildHandover('PROJECT', { project_path: args.project_path });
  return okResult(op, { themes, progress, context, handover });
}

export function applyTheme(args: { project_path: string; theme_id: string }): ToolResult {
  const op = 'apply_theme';
  const progress: ProgressItem[] = [];
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');

  const project = readYAML<{ config: { default_theme: string }; themes: { id: string; active: boolean }[]; designs: unknown[] }>(projectPath);
  const themes = project.themes ?? [];
  const themeEntry = themes.find(t => t.id === args.theme_id);
  if (!themeEntry) return errResult(op, `Theme not found: ${args.theme_id}`, `Available: ${themes.map(t => t.id).join(', ')}`, progress);

  const bak = snapshot(projectPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  for (const t of themes) t.active = t.id === args.theme_id;
  project.config.default_theme = args.theme_id;
  writeYAML(projectPath, project);
  progress.push(pOk(`Active theme set to "${args.theme_id}"`, `${(project.designs ?? []).length} design(s) affected`));

  const context = buildContext(op, `Applied theme "${args.theme_id}" to project`, [
    { type: 'project', path: projectPath, role: 'updated' },
  ]);
  const handover = buildHandover('PROJECT', { project_path: args.project_path });
  return okResult(op, { active_theme: args.theme_id, affected_designs: (project.designs ?? []).length, progress, context, handover }, bak);
}

export function duplicateDesign(args: { design_path: string; new_name: string; project_path?: string }): ToolResult {
  const op = 'duplicate_design';
  const progress: ProgressItem[] = [];
  const srcPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(srcPath)) return errResult(op, `Design not found: ${srcPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(srcPath);
  const newId = args.new_name.toLowerCase().replace(/\s+/g, '-');
  const newPath = path.join(path.dirname(srcPath), `${newId}.design.yaml`);
  if (fs.existsSync(newPath)) return errResult(op, `Design already exists: ${newPath}`, 'Choose a different new_name.', progress);

  const today = new Date().toISOString().split('T')[0];
  spec.meta.id = generateId();
  spec.meta.name = args.new_name;
  spec.meta.created = today;
  spec.meta.modified = today;
  writeYAML(newPath, spec);
  progress.push(pOk(`Duplicated to ${path.basename(newPath)}`));

  if (args.project_path) {
    const projPath = path.join(args.project_path, 'project.yaml');
    if (fs.existsSync(projPath)) {
      const bak = snapshot(projPath);
      progress.push(pInfo('Snapshot created', path.basename(bak)));
      const project = readYAML<{ designs: unknown[] }>(projPath);
      project.designs = project.designs ?? [];
      project.designs.push({ id: newId, path: `designs/${newId}.design.yaml`, type: spec.meta.type, status: 'draft' });
      writeYAML(projPath, project);
      progress.push(pOk('Registered in project.yaml'));
      const context = buildContext(op, `Duplicated "${spec.meta.name}" → "${args.new_name}"`, [
        { type: 'design', path: newPath, role: 'created' },
      ]);
      const handover = buildHandover('DESIGN', { design_path: newPath, project_path: args.project_path });
      return okResult(op, { design_id: spec.meta.id, path: newPath, progress, context, handover }, bak);
    }
  }
  const context = buildContext(op, `Duplicated design to ${path.basename(newPath)}`, [
    { type: 'design', path: newPath, role: 'created' },
  ]);
  const handover = buildHandover('DESIGN', { design_path: newPath });
  return okResult(op, { design_id: spec.meta.id, path: newPath, progress, context, handover });
}

export function resumeDesign(args: { design_path: string; project_path?: string }): ToolResult {
  const op = 'resume_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));

  if (spec._mode === 'complete') {
    progress.push(pInfo('Design is sealed', '_mode: complete'));
    const context = buildContext(op, `Design "${spec.meta.name}" is already sealed`);
    const handover = buildHandover('SEAL', { design_path: dPath });
    return okResult(op, { status: 'complete', message: 'Design sealed. Use patch_design to make changes.', progress, context, handover });
  }

  const gen = spec.meta.generation;
  const completed = gen?.completed_pages ?? 0;
  const total = gen?.total_pages ?? 0;
  const pageIds = (spec.pages ?? []).map((p: Page) => p.id);
  progress.push(pInfo(`Progress: ${completed}/${total} pages`, `pages: ${pageIds.join(', ')}`));

  const context = buildContext(op, `Resuming carousel "${spec.meta.name}" — ${total - completed} page(s) remaining`);
  const handover = buildHandover('RECOVER', { design_path: dPath, ...(args.project_path ? { project_path: args.project_path } : {}) });
  return okResult(op, {
    status: 'in_progress',
    design_id: spec.meta.id,
    design_path: dPath,
    theme: spec.theme,
    document: spec.document,
    completed_pages: completed,
    total_pages: total,
    remaining_pages: Math.max(0, total - completed),
    existing_page_ids: pageIds,
    last_operation: gen?.last_operation ?? null,
    hint: `Resume by calling append_page for pages ${completed + 1}–${total}, then seal_design.`,
    progress, context, handover,
  });
}

export function getEngineGuide(args: { section?: string }): ToolResult {
  const op = 'get_engine_guide';
  const progress: ProgressItem[] = [];
  const guide = buildGuide(args.section);
  const section = args.section ?? 'quick_ref';
  progress.push(pOk(`Guide section: ${section}`, 'sections: quick_ref | shorthand | layers | workflow'));
  const context = buildContext(op, `Loaded guide section "${section}"`);
  const handover = buildHandover('PROJECT', {});
  return okResult(op, { section, guide, sections_available: 'quick_ref | shorthand | layers | workflow', progress, context, handover });
}

export function listTasks(args: { project_path: string }): ToolResult {
  const op = 'list_tasks';
  const progress: ProgressItem[] = [];
  const tasksDir = path.join(args.project_path, '.tasks');
  if (!fs.existsSync(tasksDir)) {
    progress.push(pInfo('No tasks directory found'));
    const context = buildContext(op, 'No tasks found in project');
    const handover = buildHandover('PROJECT', { project_path: args.project_path });
    return okResult(op, { tasks: [], total: 0, truncated: false, progress, context, handover });
  }

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
  progress.push(pOk(`Found ${files.length} task(s)`, truncated ? `truncated at ${limit}` : ''));
  const context = buildContext(op, `Listed ${files.length} task(s) in project`);
  const handover = buildHandover('RECOVER', { project_path: args.project_path });
  return okResult(op, { tasks, total: files.length, truncated, progress, context, handover });
}

export function createTask(args: { project_path: string; task_name: string; brief: string; theme?: string; pages: { id?: string; label: string; hints?: string }[]; width?: number; height?: number }): ToolResult {
  const op = 'create_task';
  const progress: ProgressItem[] = [];
  if (!args.pages || args.pages.length === 0) return errResult(op, 'pages array must not be empty', 'Provide at least one page: [{label:"Cover",hints:"..."}]');

  const designResult = createDesign({
    project_path: args.project_path, name: args.task_name, type: 'carousel',
    width: args.width, height: args.height, theme_ref: args.theme,
  });
  if (!designResult.success) return { ...designResult, op };
  progress.push(pOk('Created carousel scaffold', designResult['path'] as string));

  const designPath = designResult['path'] as string;
  const { taskPath, spec } = createTaskFile({
    projectPath: args.project_path, taskName: args.task_name, brief: args.brief,
    designPath, theme: args.theme ?? 'dark-tech', pages: args.pages,
  });
  progress.push(pOk(`Task created: ${args.pages.length} page(s) planned`, taskPath));

  const next_action: NextAction = buildNextAction(spec, taskPath);
  const context = buildContext(op, `Task "${args.task_name}" created with ${args.pages.length} pages`, [
    { type: 'task', path: taskPath, role: 'created' },
    { type: 'design', path: designPath, role: 'scaffold' },
  ]);
  const handover = buildHandover('COMPOSE', {
    task_path: taskPath, design_path: designPath, project_path: args.project_path,
  });
  return okResult(op, {
    task_id: spec.task_id, task_path: taskPath, design_path: designPath,
    total_pages: spec.pages.length, next_action, progress, context, handover,
  });
}

export function resumeTask(args: { task_path: string }): ToolResult {
  const op = 'resume_task';
  const progress: ProgressItem[] = [];
  if (!fs.existsSync(args.task_path)) return errResult(op, `Task not found: ${args.task_path}`, 'Check task_path. Use list_tasks to find in-progress tasks.');

  const spec = readTask(args.task_path);
  const done = spec.pages.filter(p => p.status === 'done').length;
  const pending = spec.pages.filter(p => p.status === 'pending').length;
  progress.push(pOk(`Task progress: ${done}/${spec.total_pages}`, `${pending} remaining`));

  const next_action: NextAction = buildNextAction(spec, args.task_path);
  const isComplete = pending === 0;
  if (isComplete) progress.push(pInfo('All pages complete — call seal_design'));
  else progress.push(pInfo('Next action', next_action.tool));

  const context = buildContext(op, `Task ${isComplete ? 'complete' : `${done}/${spec.total_pages} pages done`}`);
  const handover = buildHandover(isComplete ? 'SEAL' : 'COMPOSE', {
    task_path: args.task_path, design_path: spec.design_path,
  });
  return okResult(op, {
    status: isComplete ? 'complete' : 'in_progress',
    task_id: spec.task_id, brief: spec.brief,
    design_path: spec.design_path, total_pages: spec.total_pages,
    completed_pages: done, remaining_pages: pending,
    next_action, progress, context, handover,
  });
}

// ── Tier 2 — Design Lifecycle ─────────────────────────────────

// §10 — surgical read: IDs + types + positions only, NOT content values
// Constrained mode: returns metadata-only when layer count exceeds READ_TOKEN_CAP
export function inspectDesign(args: { design_path: string; page_id?: string; project_path?: string }): ToolResult {
  const op = 'inspect_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const limit = LIMITS.layer_rows;
  const constrained = isConstrained();

  const summarise = (layers: Layer[] = []) => {
    if (constrained && layers.length > limit) {
      progress.push(pWarn('Constrained mode: returning metadata only', `${layers.length} layers total`));
      return [];
    }
    return layers.slice(0, limit).map(l => ({ id: l.id, type: l.type, z: l.z, x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: (l as unknown as Record<string, unknown>)['height'] ?? 0 }));
  };

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    const layers = summarise(page.layers);
    const total = (page.layers ?? []).length;
    progress.push(pOk(`Inspected page "${page.id}"`, `${total} layer(s)`));
    const context = buildContext(op, `Inspected page "${page.id}" — ${total} layer(s)`);
    const handover = buildHandover('COMPOSE', { design_path: dPath, page_id: page.id });
    return okResult(op, { page_id: page.id, label: page.label, layers, layer_count: total, truncated: total > limit, constrained_metadata_only: constrained && total > limit, progress, context, handover });
  }

  if (spec.pages) {
    const pageLimit = LIMITS.list_rows;
    const pages = spec.pages.slice(0, pageLimit).map(p => ({ id: p.id, label: p.label, layer_count: (p.layers ?? []).length }));
    progress.push(pOk(`Inspected carousel: ${spec.pages.length} page(s)`));
    const context = buildContext(op, `Carousel "${spec.meta.name}" — ${spec.pages.length} page(s)`);
    const handover = buildHandover('COMPOSE', { design_path: dPath });
    return okResult(op, { type: 'carousel', page_count: spec.pages.length, pages, mode: spec._mode, theme: spec.theme?.ref, document: spec.document, truncated: spec.pages.length > pageLimit, progress, context, handover });
  }

  const layers = summarise(spec.layers);
  const total = (spec.layers ?? []).length;
  progress.push(pOk(`Inspected poster: ${total} layer(s)`));
  const context = buildContext(op, `Poster "${spec.meta.name}" — ${total} layer(s)`);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { type: 'poster', layers, layer_count: total, mode: spec._mode, theme: spec.theme?.ref, document: spec.document, truncated: total > limit, constrained_metadata_only: constrained && total > limit, progress, context, handover });
}

export function addLayers(args: {
  design_path: string; page_id?: string; project_path?: string;
  layers?: Layer[]; layers_shorthand?: ShorthandLayer[]; task_path?: string;
}): ToolResult {
  const op = 'add_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  if (!args.layers?.length && !args.layers_shorthand?.length) return errResult(op, 'No layers provided', 'Pass layers or layers_shorthand array.');

  const incoming: Layer[] = args.layers_shorthand?.length
    ? expandShorthandLayers(args.layers_shorthand)
    : (args.layers ?? []);
  progress.push(pInfo(`Expanding ${incoming.length} layer(s)`, args.layers_shorthand?.length ? 'via shorthand' : 'verbose'));

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    if (!page.layers) page.layers = [];
    page.layers.push(...incoming);
  } else {
    if (!spec.layers) spec.layers = [];
    spec.layers.push(...incoming);
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Added ${incoming.length} layer(s)`, incoming.map(l => l.id).join(', ')));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: 0, hint: 'Layers added. Call seal_design or add more layers.' };
  const context = buildContext(op, `Added ${incoming.length} layer(s) to ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, ...(args.task_path ? { task_path: args.task_path } : {}) });
  return okResult(op, { added: incoming.length, layer_ids: incoming.map(l => l.id), next_action, progress, context, handover }, bak);
}

export function appendPage(args: {
  design_path: string; page_id?: string; label?: string; template_ref?: string;
  slots?: Record<string, unknown>; layers?: Layer[]; layers_shorthand?: ShorthandLayer[];
  task_path?: string; project_path?: string;
}): ToolResult {
  const op = 'append_page';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const layers: Layer[] = args.layers_shorthand?.length
    ? expandShorthandLayers(args.layers_shorthand)
    : (args.layers ?? []);
  progress.push(pInfo(`Page has ${layers.length} layer(s)`, args.layers_shorthand?.length ? 'via shorthand' : 'verbose'));

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  if (!spec.pages) spec.pages = [];

  const pageId = args.page_id ?? `page_${spec.pages.length + 1}`;
  spec.pages.push({ id: pageId, label: args.label ?? `Page ${spec.pages.length + 1}`, template_ref: args.template_ref, slots: args.slots, layers });

  if (spec.meta.generation) {
    spec.meta.generation.completed_pages = spec.pages.length;
    spec.meta.generation.total_pages = Math.max(spec.meta.generation.total_pages, spec.pages.length);
    spec.meta.generation.last_operation = 'append_page';
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Appended page "${pageId}"`, `total: ${spec.pages.length} page(s)`));

  let next_action: NextAction | undefined;
  if (args.task_path && fs.existsSync(args.task_path)) {
    const taskSpec = readTask(args.task_path);
    markPageDone(taskSpec, pageId);
    writeTask(args.task_path, taskSpec);
    next_action = buildNextAction(taskSpec, args.task_path);
    progress.push(pInfo('Task updated', next_action.tool));
  }

  const context = buildContext(op, `Appended page "${pageId}" — ${spec.pages.length} total`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const remaining = next_action ? next_action.remaining : 0;
  const handover = buildHandover(remaining === 0 ? 'SEAL' : 'COMPOSE', {
    design_path: dPath, ...(args.task_path ? { task_path: args.task_path } : {}),
  });
  return okResult(op, { page_id: pageId, page_count: spec.pages.length, ...(next_action ? { next_action } : {}), progress, context, handover }, bak);
}

export function patchDesign(args: { design_path: string; selectors: { path: string; value: unknown }[]; dry_run?: boolean; project_path?: string }): ToolResult {
  const op = 'patch_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const invalid = args.selectors.filter(s => typeof s.path !== 'string' || !s.path);
  if (invalid.length > 0) return errResult(op, 'Selectors missing path field', 'Each selector needs { path: "dot.path", value: ... }', progress);

  if (args.dry_run) {
    // Validate without touching the file
    const spec = readYAML<Record<string, unknown>>(dPath);
    const wouldPatch: string[] = [];
    const errors: string[] = [];
    for (const sel of args.selectors) {
      try { setNestedValue(spec, sel.path, sel.value); wouldPatch.push(sel.path); }
      catch (e) { errors.push(`${sel.path}: ${(e as Error).message}`); }
    }
    progress.push(errors.length === 0 ? pOk(`Dry-run: ${wouldPatch.length} path(s) valid`) : pWarn('Dry-run: some paths invalid', errors.join('; ')));
    const context = buildContext(op, `Dry-run validated ${wouldPatch.length} selector(s)`);
    const handover = buildHandover('PATCH', { design_path: dPath });
    return okResult(op, { dry_run: true, would_patch: wouldPatch, errors, progress, context, handover });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<Record<string, unknown>>(dPath);
  const patched: string[] = [];
  for (const sel of args.selectors) { setNestedValue(spec, sel.path, sel.value); patched.push(sel.path); }
  writeYAML(dPath, spec);
  progress.push(pOk(`Patched ${patched.length} field(s)`, patched.join(', ')));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Fields patched. Call seal_design or make further patches.' };
  const context = buildContext(op, `Patched ${patched.length} field(s) in ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { patched_paths: patched, count: patched.length, next_action, progress, context, handover }, bak);
}

export function sealDesign(args: { design_path: string; project_path?: string }): ToolResult {
  const op = 'seal_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  spec._mode = 'complete';
  if (spec.meta.generation) spec.meta.generation.status = 'complete';
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk('Design sealed', `${spec.pages?.length ?? 0} page(s), ${spec.layers?.length ?? 0} root layer(s)`));

  const next_action: NextAction = { tool: 'export_design', params: { design_path: dPath, format: 'svg' }, remaining: 0, hint: 'Export with export_design or open in editor.' };
  const context = buildContext(op, `Sealed design "${spec.meta.name}"`, [
    { type: 'design', path: dPath, role: 'sealed' },
  ]);
  const handover = buildHandover('SEAL', { design_path: dPath });
  return okResult(op, { status: 'sealed', pages: spec.pages?.length ?? 0, layers: spec.layers?.length ?? 0, next_action, progress, context, handover }, bak);
}

export function addLayer(args: { design_path: string; page_id?: string; layer: Layer; project_path?: string }): ToolResult {
  const op = 'add_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);

  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    if (!page.layers) page.layers = [];
    page.layers.push(args.layer);
  } else {
    if (!spec.layers) spec.layers = [];
    spec.layers.push(args.layer);
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Added layer "${args.layer.id}"`, args.layer.type));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Continue adding layers or call seal_design.' };
  const context = buildContext(op, `Added layer "${args.layer.id}" to ${path.basename(dPath)}`);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { layer_id: args.layer.id, next_action, progress, context, handover }, bak);
}

export function updateLayer(args: { design_path: string; layer_id: string; props: Partial<Layer>; project_path?: string }): ToolResult {
  const op = 'update_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  let found = false;

  const patch = (layers: Layer[]): Layer[] =>
    layers.map(l => { if (l.id === args.layer_id) { found = true; return { ...l, ...args.props } as Layer; } return l; });

  if (spec.layers) spec.layers = patch(spec.layers);
  if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = patch(page.layers); }
  if (!found) return errResult(op, `Layer not found: ${args.layer_id}`, 'Use inspect_design to find layer IDs.', progress);

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Updated layer "${args.layer_id}"`, Object.keys(args.props).join(', ')));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Continue editing or call seal_design.' };
  const context = buildContext(op, `Updated layer "${args.layer_id}" in ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { updated: args.layer_id, next_action, progress, context, handover }, bak);
}

export function removeLayer(args: { design_path: string; layer_id: string; project_path?: string }): ToolResult {
  const op = 'remove_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  if (spec.layers) spec.layers = spec.layers.filter(l => l.id !== args.layer_id);
  if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = page.layers.filter(l => l.id !== args.layer_id); }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Removed layer "${args.layer_id}"`));

  const next_action: NextAction = { tool: 'inspect_design', params: { design_path: dPath }, remaining: -1, hint: 'Verify removal with inspect_design, then continue or seal.' };
  const context = buildContext(op, `Removed layer "${args.layer_id}" from ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { removed: args.layer_id, next_action, progress, context, handover }, bak);
}

// ── Tier 3 — Export & Templates ──────────────────────────────

export function exportDesign(args: { design_path: string; format: string; output_path?: string; scale?: number; project_path?: string }): ToolResult {
  const op = 'export_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const criticals = validateDesignSpec(spec).filter(e => e.severity === 'error');
  if (criticals.length > 0) return errResult(op, `Validation errors: ${criticals.map(e => e.message).join('; ')}`, 'Fix errors then retry.', progress);

  const outPath = args.output_path ?? dPath.replace('.design.yaml', `.${args.format}`);
  if (args.format === 'svg') {
    try {
      const svgStr = renderToSVGString(spec);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, svgStr, 'utf-8');
      progress.push(pOk('SVG written', path.basename(outPath)));
      const context = buildContext(op, `SVG exported for "${spec.meta.name}"`, [
        { type: 'svg', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'svg', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: svgStr.length, progress, context, handover });
    } catch (err) {
      return errResult(op, `SVG render failed: ${(err as Error).message}`, 'Check design spec validity.', progress);
    }
  }
  if (args.format === 'html') {
    try {
      
      const datasets = new Map<string, LoadedDataset>();
      const sources: { id: string; rows?: Record<string, unknown>[] }[] = spec.report?.data?.sources ?? [];
      for (const src of sources) {
        if (src.rows) datasets.set(src.id, { id: src.id, rows: src.rows });
      }
      const html: string = spec.meta.type === 'report'
        ? assembleReportHTML(spec, datasets, {})
        : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${spec.meta.name}</title></head><body>${renderToSVGString(spec)}</body></html>`;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf-8');
      progress.push(pOk('HTML written', path.basename(outPath)));
      const context = buildContext(op, `HTML exported for "${spec.meta.name}"`, [{ type: 'html', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'html', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: html.length, progress, context, handover });
    } catch (err) {
      return errResult(op, `HTML export failed: ${(err as Error).message}`, 'Check design spec.', progress);
    }
  }
  if (args.format === 'pdf') {
    // PDF via Puppeteer is async — export HTML first, then call exportToPuppeteerPDF separately
    const htmlPath = outPath.replace(/\.pdf$/, '-puppeteer.html');
    try {
      
      const datasets = new Map<string, LoadedDataset>();
      const sources: { id: string; rows?: Record<string, unknown>[] }[] = spec.report?.data?.sources ?? [];
      for (const src of sources) {
        if (src.rows) datasets.set(src.id, { id: src.id, rows: src.rows });
      }
      const html: string = assembleReportHTML(spec, datasets, {});
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.writeFileSync(htmlPath, html, 'utf-8');
      progress.push(pOk('HTML staged for Puppeteer PDF', path.basename(htmlPath)));
    } catch {
      progress.push(pWarn('HTML staging failed; PDF may be incomplete'));
    }
    const context = buildContext(op, `PDF requires async Puppeteer step`, [{ type: 'html', path: htmlPath, role: 'pdf-stage' }]);
    const handover = buildHandover('EXPORT', { design_path: dPath, html_path: htmlPath });
    return okResult(op, { format: 'pdf', output_file: path.basename(outPath), output_path: outPath, status: 'puppeteer_required', html_path: htmlPath, hint: 'Call exportToPuppeteerPDF(htmlPath, outputPath) from Node to complete.', progress, context, handover });
  }
  const context = buildContext(op, `Export format ${args.format} not supported`);
  const handover = buildHandover('EXPORT', { design_path: dPath });
  return okResult(op, { format: args.format, status: 'unsupported', hint: `Supported formats: svg, html, pdf`, progress, context, handover });
}

export function batchCreate(args: { project_path: string; template_id: string; slots_array: Record<string, unknown>[] }): ToolResult {
  const op = 'batch_create';
  const progress: ProgressItem[] = [];
  const created: { design_id: string; path: string }[] = [];

  for (let i = 0; i < args.slots_array.length; i++) {
    const slots = args.slots_array[i];
    const name = (slots['name'] as string | undefined) ?? `${args.template_id}-${i + 1}`;
    const r = createDesign({ project_path: args.project_path, name, type: 'poster' });
    if (!r.success) return errResult(op, `Failed at design ${i + 1}: ${r.error ?? ''}`, r.hint ?? '', progress);

    const designPath = r['path'] as string;
    const selectors = Object.entries(slots).filter(([k]) => k !== 'name').map(([k, v]) => ({ path: k, value: v }));
    if (selectors.length > 0) {
      const pr = patchDesign({ design_path: designPath, selectors });
      if (!pr.success) return errResult(op, `Patch failed at design ${i + 1}: ${pr.error ?? ''}`, pr.hint ?? '', progress);
    }
    created.push({ design_id: r['design_id'] as string, path: designPath });
    progress.push(pOk(`Created design ${i + 1}/${args.slots_array.length}`, name));
  }

  const context = buildContext(op, `Batch created ${created.length} design(s)`,
    created.map(c => ({ type: 'design', path: c.path, role: 'created' })));
  const handover = buildHandover('EXPORT', { project_path: args.project_path });
  return okResult(op, { created, count: created.length, progress, context, handover });
}

export function saveAsComponent(args: { design_path: string; layer_ids: string[]; component_name: string; project_path: string }): ToolResult {
  const op = 'save_as_component';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  const extracted = (spec.layers ?? []).filter(l => args.layer_ids.includes(l.id));
  if (extracted.length === 0) return errResult(op, `No matching layers for IDs: ${args.layer_ids.join(', ')}`, 'Use inspect_design to get layer IDs.', progress);

  const componentId = args.component_name.toLowerCase().replace(/\s+/g, '-');
  const componentPath = path.join(args.project_path, `components/${componentId}.component.yaml`);
  writeYAML(componentPath, { _protocol: 'component/v1', name: args.component_name, id: componentId, version: '1.0.0', props: {}, layers: extracted });
  progress.push(pOk(`Wrote component "${args.component_name}"`, path.basename(componentPath)));

  const indexPath = path.join(args.project_path, 'components/index.yaml');
  const index = fs.existsSync(indexPath) ? readYAML<{ components: unknown[] }>(indexPath) : { components: [] };
  index.components = index.components ?? [];
  index.components.push({ id: componentId, path: `components/${componentId}.component.yaml`, name: args.component_name });
  writeYAML(indexPath, index);

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const firstLayer = extracted[0];
  const instance = { id: `${componentId}-instance`, type: 'component', z: firstLayer.z, x: firstLayer.x ?? 0, y: firstLayer.y ?? 0, width: firstLayer.width ?? 0, height: firstLayer.height ?? 0, ref: componentId, slots: {} } as unknown as Layer;
  spec.layers = [...(spec.layers ?? []).filter(l => !args.layer_ids.includes(l.id)), instance].sort((a, b) => a.z - b.z);
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Replaced ${extracted.length} layer(s) with component instance`));

  const context = buildContext(op, `Extracted ${extracted.length} layer(s) into component "${args.component_name}"`, [
    { type: 'component', path: componentPath, role: 'created' },
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, project_path: args.project_path });
  return okResult(op, { component_id: componentId, component_path: componentPath, layers_extracted: extracted.length, instance_id: instance.id, progress, context, handover }, bak);
}

export function exportTemplate(args: { design_path: string; output_path?: string; project_path?: string }): ToolResult {
  const op = 'export_template';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const template = exportAsTemplate(spec);
  const outPath = args.output_path ?? dPath.replace(/\.design\.yaml$/, '.template.yaml');
  writeYAML(outPath, template);
  progress.push(pOk(`Wrote template (${template.slots.length} slot(s))`, path.basename(outPath)));

  const slots = template.slots.map(s => ({ id: s.id, path: s.path, type: s.type, hint: s.hint }));
  const next_action: NextAction = { tool: 'inject_template', params: { template_path: outPath, slots: Object.fromEntries(slots.map(s => [s.id, ''])) }, remaining: 1, hint: 'Fill slot values then call inject_template.' };
  const context = buildContext(op, `Exported template with ${slots.length} slot(s)`, [
    { type: 'template', path: outPath, role: 'created' },
  ]);
  const handover = buildHandover('EXPORT', { template_path: outPath });
  return okResult(op, { template_path: outPath, template_file: path.basename(outPath), slot_count: slots.length, slots, next_action, progress, context, handover });
}

export function injectTemplate(args: { template_path: string; slots: Record<string, unknown>; output_path?: string }): ToolResult {
  const op = 'inject_template';
  const progress: ProgressItem[] = [];
  const tPath = resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);
  progress.push(pOk('Loaded template', path.basename(tPath)));

  const design = injectIntoTemplate(template, args.slots);
  design.meta.modified = new Date().toISOString().split('T')[0];
  const outPath = args.output_path ?? tPath.replace(/\.template\.yaml$/, `.${Date.now().toString(36)}.design.yaml`);
  writeYAML(outPath, design);
  progress.push(pOk(`Injected ${Object.keys(args.slots).length} slot(s)`, path.basename(outPath)));

  const next_action: NextAction = { tool: 'export_design', params: { design_path: outPath, format: 'svg' }, remaining: 1, hint: 'Export with export_design or open in editor.' };
  const context = buildContext(op, `Injected ${Object.keys(args.slots).length} slot(s) → ${path.basename(outPath)}`, [
    { type: 'design', path: outPath, role: 'created' },
  ]);
  const handover = buildHandover('EXPORT', { design_path: outPath });
  return okResult(op, { design_path: outPath, design_file: path.basename(outPath), slots_injected: Object.keys(args.slots).length, next_action, progress, context, handover });
}

export function listTemplateSlots(args: { template_path: string }): ToolResult {
  const op = 'list_template_slots';
  const progress: ProgressItem[] = [];
  const tPath = resolveDesignPath(args.template_path);
  if (!fs.existsSync(tPath)) return errResult(op, `Template not found: ${tPath}`, 'Check the template_path value.');

  const template = readYAML<TemplateSpec>(tPath);
  if (template._protocol !== 'template/v1') return errResult(op, 'File is not a template', 'Expected _protocol: template/v1', progress);

  const slots = listSlots(template);
  progress.push(pOk(`Found ${slots.length} slot(s)`, path.basename(tPath)));
  const context = buildContext(op, `Listed ${slots.length} slot(s) in template`);
  const handover = buildHandover('EXPORT', { template_path: tPath });
  return okResult(op, { slots, count: slots.length, progress, context, handover });
}

// ── Presentation MCP tools ───────────────────────────────────

export function createPresentation(args: {
  project_path: string;
  name: string;
  pages: { id?: string; label: string; notes?: string }[];
  width?: number;
  height?: number;
  transition?: string;
  auto_advance?: number;
  theme?: 'dark' | 'light';
}): ToolResult {
  const op = 'create_presentation';
  const progress: ProgressItem[] = [];
  const pDir = path.resolve(args.project_path);
  if (!fs.existsSync(pDir)) return errResult(op, `Project not found: ${pDir}`, 'Check project_path.');

  const id = generateId();
  const slug = args.name.toLowerCase().replace(/\s+/g, '-');
  const dPath = path.join(pDir, 'designs', `${slug}.design.yaml`);
  fs.mkdirSync(path.dirname(dPath), { recursive: true });

  const pages = args.pages.map((p, i) => ({
    id: p.id ?? `slide_${i + 1}`,
    label: p.label,
    notes: p.notes,
    layers: [] as unknown[],
    transition: args.transition ? { type: args.transition, duration: 400 } : undefined,
    auto_advance: args.auto_advance,
  }));

  const spec = {
    _protocol: 'design/v1',
    _mode: 'in_progress',
    meta: { id, name: args.name, type: 'presentation', created: new Date().toISOString(), modified: new Date().toISOString() },
    document: { width: args.width ?? 1920, height: args.height ?? 1080, unit: 'px', dpi: 96 },
    pages,
    presentation: {
      auto_advance: args.auto_advance ?? 0,
      show_controls: true,
      show_progress: true,
      keyboard: true,
      touch: true,
      aspect_ratio: '16:9',
    },
  };

  writeYAML(dPath, spec);
  progress.push(pOk('Presentation design created', path.basename(dPath)));
  const context = buildContext(op, `Presentation "${args.name}" scaffolded (${pages.length} slides)`, [
    { type: 'design', path: dPath, role: 'presentation' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { design_id: id, design_path: dPath, slide_count: pages.length, progress, context, handover });
}

export function exportPresentation(args: {
  design_path: string;
  output_path?: string;
  theme?: 'light' | 'dark';
  auto_advance?: number;
  project_path?: string;
}): ToolResult {
  const op = 'export_presentation';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<import('../schema/types').DesignSpec>(dPath);
  if (!['presentation', 'carousel', 'motion'].includes(spec.meta.type)) {
    return errResult(op, `Design type "${spec.meta.type}" not supported for presentation export`, 'Use a presentation, carousel, or motion design.', progress);
  }

  const outPath = args.output_path ?? dPath.replace('.design.yaml', '.presentation.html');

  // Load formula context if available (applied at runtime in browser via JS runtime)
  const formulaCtxPath = dPath.replace('.design.yaml', '.formula.json');
  if (fs.existsSync(formulaCtxPath)) {
    try { JSON.parse(fs.readFileSync(formulaCtxPath, 'utf-8')); } catch { /* ignore */ }
  }

  progress.push(pInfo('Assembling presentation HTML'));
  try {
    const html = assemblePresentationHTML(spec, { theme: args.theme ?? 'dark', auto_advance: args.auto_advance });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    progress.push(pOk('Presentation HTML written', path.basename(outPath)));
    const context = buildContext(op, `Presentation exported: ${path.basename(outPath)}`, [
      { type: 'html', path: outPath, role: 'presentation-output' },
    ]);
    const handover = buildHandover('EXPORT', { output_path: outPath });
    return okResult(op, { output_path: outPath, output_file: path.basename(outPath), bytes: html.length, slide_count: (spec.pages ?? []).length, progress, context, handover });
  } catch (err) {
    return errResult(op, `Presentation assembly failed: ${(err as Error).message}`, 'Ensure design has pages.', progress);
  }
}

// ── Report MCP tools ─────────────────────────────────────────

export function generateReport(args: {
  project_path: string;
  name: string;
  layout?: 'paged' | 'scroll' | 'tabs' | 'sidebar';
  nav_type?: 'sidebar' | 'topbar' | 'tabs' | 'dots';
  pages: { id?: string; label: string }[];
  width?: number;
  height?: number;
  data_sources?: { id: string; type: 'inline' | 'json' | 'csv'; path?: string; rows?: Record<string, unknown>[] }[];
}): ToolResult {
  const op = 'generate_report';
  const progress: ProgressItem[] = [];
  const pDir = path.resolve(args.project_path);
  if (!fs.existsSync(pDir)) return errResult(op, `Project not found: ${pDir}`, 'Check project_path.');

  const id = generateId();
  const dPath = path.join(pDir, 'designs', `${args.name.toLowerCase().replace(/\s+/g, '-')}.design.yaml`);
  fs.mkdirSync(path.dirname(dPath), { recursive: true });

  const pages = args.pages.map((p, i) => ({
    id: p.id ?? `page_${i + 1}`,
    label: p.label,
    layers: [] as unknown[],
  }));

  const spec: DesignSpec = {
    _protocol: 'design/v1',
    _mode: 'in_progress',
    meta: { id, name: args.name, type: 'report', created: new Date().toISOString(), modified: new Date().toISOString() },
    document: { width: args.width ?? 1080, height: args.height ?? 1080, unit: 'px' },
    pages: pages as Page[],
    report: {
      layout: args.layout ?? 'paged',
      navigation: args.nav_type ? { type: args.nav_type } : { type: 'sidebar' },
      data: args.data_sources ? { sources: args.data_sources } : undefined,
    },
  } as unknown as DesignSpec;

  writeYAML(dPath, spec);
  progress.push(pOk(`Report design created`, path.basename(dPath)));
  const context = buildContext(op, `Report "${args.name}" scaffolded (${pages.length} pages)`, [
    { type: 'design', path: dPath, role: 'report' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { design_id: id, design_path: dPath, page_count: pages.length, progress, context, handover });
}

export function bindData(args: {
  design_path: string;
  datasets: { id: string; rows: Record<string, unknown>[] }[];
  project_path?: string;
}): ToolResult {
  const op = 'bind_data';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  const dataSpec = spec.report?.data ?? { sources: [] };
  const existingIds = new Set((dataSpec.sources ?? []).map((s: { id: string }) => s.id));

  for (const ds of args.datasets) {
    if (!existingIds.has(ds.id)) {
      (dataSpec.sources ?? (dataSpec.sources = [])).push({
        id: ds.id,
        type: 'inline',
        rows: ds.rows,
      });
    } else {
      const src = (dataSpec.sources ?? []).find((s: { id: string }) => s.id === ds.id);
      if (src) src.rows = ds.rows;
    }
    progress.push(pOk(`Bound dataset "${ds.id}"`, `${ds.rows.length} rows`));
  }

  if (!spec.report) spec.report = { layout: 'paged' };
  (spec.report as unknown as Record<string, unknown>)['data'] = dataSpec;
  writeYAML(dPath, spec);

  const context = buildContext(op, `Bound ${args.datasets.length} dataset(s) to report`, [
    { type: 'design', path: dPath, role: 'report' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath });
  return okResult(op, { bound: args.datasets.map(d => ({ id: d.id, rows: d.rows.length })), progress, context, handover });
}

export function exportReport(args: {
  design_path: string;
  output_path?: string;
  theme?: 'light' | 'dark';
  project_path?: string;
}): ToolResult {
  const op = 'export_report';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  if (spec.meta.type !== 'report') {
    return errResult(op, 'Design is not type "report"', 'Use export_design for non-report types.', progress);
  }

  const outPath = args.output_path ?? dPath.replace('.design.yaml', '.report.html');
  progress.push(pInfo('Assembling report HTML'));

  try {
    
    const datasets = new Map<string, LoadedDataset>();
    const sources: { id: string; rows?: Record<string, unknown>[] }[] = spec.report?.data?.sources ?? [];
    for (const src of sources) {
      if (src.rows) datasets.set(src.id, { id: src.id, rows: src.rows });
    }

    const html: string = assembleReportHTML(spec, datasets, { theme: args.theme ?? 'dark' });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    progress.push(pOk('Report HTML written', path.basename(outPath)));

    const context = buildContext(op, `Report exported as HTML: ${path.basename(outPath)}`, [
      { type: 'html', path: outPath, role: 'report-output' },
    ]);
    const handover = buildHandover('EXPORT', { output_path: outPath });
    return okResult(op, { output_path: outPath, output_file: path.basename(outPath), bytes: html.length, progress, context, handover });
  } catch (err) {
    return errResult(op, `HTML assembly failed: ${(err as Error).message}`, 'Ensure design has pages.', progress);
  }
}

// ── Formula tools ─────────────────────────────────────────────

export function setFormulaContext(args: {
  design_path: string;
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  project_path?: string;
}): ToolResult {
  const op = 'set_formula_context';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const ctxPath = dPath.replace('.design.yaml', '.formula.json');
  const payload = { state: args.state ?? {}, data: args.data ?? {} };
  fs.writeFileSync(ctxPath, JSON.stringify(payload, null, 2), 'utf-8');

  return okResult(op, {
    context_path: ctxPath,
    keys: {
      state: Object.keys(args.state ?? {}),
      data: Object.keys(args.data ?? {}),
    },
  });
}

export function debugFormula(args: {
  formula: string;
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  design_path?: string;
  project_path?: string;
}): ToolResult {
  const op = 'debug_formula';
  if (!isFormula(args.formula)) {
    return errResult(op, 'Formula must start with =', 'Formula must start with =');
  }

  let state: Record<string, unknown> = args.state ?? {};
  let data: Record<string, unknown> = args.data ?? {};

  if (args.design_path) {
    const dPath = resolveDesignPath(args.design_path, args.project_path);
    const ctxPath = dPath.replace('.design.yaml', '.formula.json');
    if (fs.existsSync(ctxPath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(ctxPath, 'utf-8')) as Record<string, unknown>;
        state = { ...(loaded['state'] as Record<string, unknown> ?? {}), ...state };
        data  = { ...(loaded['data']  as Record<string, unknown> ?? {}), ...data };
      } catch { /* ignore malformed .formula.json */ }
    }
  }

  const ctx: FormulaContext = { state, data };
  const result = evaluateFormula(args.formula, ctx);
  return okResult(op, { result, type: typeof result, formula: args.formula });
}

// ── Internal shared helpers ───────────────────────────────────

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

function isConstrained(): boolean {
  return process.env['MCP_CONSTRAINED_MODE'] === 'true';
}

// ── Animation timeline tools ──────────────────────────────────

export function inspectTimeline(args: {
  design_path: string;
  page_id?: string;
  project_path?: string;
}): ToolResult {
  const op = 'inspect_timeline';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const spec = readYAML<DesignSpec>(dPath);
  let layers: Layer[];

  if (args.page_id) {
    const page = (spec.pages ?? []).find((p: Page) => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Check page_id.');
    layers = page.layers ?? [];
  } else {
    layers = spec.layers ?? [];
  }

  const tracks = buildTimelineTracks(
    layers.map(l => ({
      id: l.id,
      label: (l as { label?: string }).label,
      animation: l.animation,
    })),
  );
  const ascii = renderTimelineASCII(tracks);

  return okResult(op, { track_count: tracks.length, tracks, ascii });
}

export function addKeyframeToLayer(args: {
  design_path: string;
  layer_id: string;
  keyframe: Keyframe;
  project_path?: string;
}): ToolResult {
  const op = 'add_keyframe';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const bak = snapshot(dPath);
  const spec = readYAML<DesignSpec>(dPath);

  // Search top-level layers first, then each page
  let found = false;
  const applyToLayer = (layer: Layer): Layer => {
    if (layer.id !== args.layer_id) return layer;
    found = true;
    return { ...layer, animation: addKeyframe(layer.animation ?? {}, args.keyframe) };
  };

  if (spec.layers) {
    spec.layers = spec.layers.map(applyToLayer);
  }
  if (!found && spec.pages) {
    for (const page of spec.pages) {
      if (page.layers) {
        page.layers = page.layers.map(applyToLayer);
        if (found) break;
      }
    }
  }

  if (!found) return errResult(op, `Layer not found: ${args.layer_id}`, 'Check layer_id.');

  writeYAML(dPath, spec);
  return okResult(op, { layer_id: args.layer_id, keyframe: args.keyframe }, bak);
}

// ── Phase 5 — Animation / Remote / Collab ────────────────────

export function exportAnimation(args: {
  design_path: string;
  type: 'gif' | 'mp4' | 'webm';
  output_path?: string;
  fps?: number;
  duration?: number;
  page_id?: string;
  project_path?: string;
}): ToolResult {
  const op = 'export_animation';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  // Build HTML for the design, then record animation frames
  const spec = readYAML<DesignSpec>(dPath);
  let html: string;
  try {
    html = assemblePresentationHTML(spec, {});
  } catch (e) {
    return errResult(op, `Failed to render HTML: ${(e as Error).message}`, 'Ensure the design has valid pages.');
  }

  const ext = args.type === 'gif' ? 'gif' : args.type === 'mp4' ? 'mp4' : 'webm';
  const baseName = path.basename(dPath, '.design.yaml');
  const outputPath = args.output_path ?? path.join(path.dirname(dPath), '..', 'exports', `${baseName}.${ext}`);
  const htmlPath = outputPath + '.tmp.html';

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);

  // Since exportToAnimation is async, we return instructions for running it
  // The MCP tool provides instructions; actual encode is via CLI/script
  fs.unlinkSync(htmlPath);

  const hasFfmpeg = tryFfmpeg();

  return okResult(op, {
    design_path: dPath,
    output_path: outputPath,
    type: args.type,
    fps: args.fps ?? (args.type === 'gif' ? 10 : 30),
    duration: args.duration ?? 3000,
    ffmpeg_available: hasFfmpeg,
    hint: hasFfmpeg
      ? `Run: npx folio export-anim "${dPath}" --type ${args.type} --output "${outputPath}"`
      : 'ffmpeg not found. Install ffmpeg then re-run this tool.',
  });
}

export function setupRemotePresenter(args: {
  port?: number;
  design_path?: string;
  project_path?: string;
}): ToolResult {
  const op = 'setup_remote_presenter';
  const port = args.port ?? 3737;

  const clientScript = getClientScript(port);

  const curlNext = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"next"}'`;
  const curlPrev = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"prev"}'`;
  const curlGoto = `curl -s -X POST http://localhost:${port}/command -H 'Content-Type: application/json' -d '{"type":"goto","slide":0}'`;

  return okResult(op, {
    port,
    server_start_command: `node -e "const{startRemoteServer}=require('./dist/export/remote-server');startRemoteServer(${port}).then(()=>console.log('Remote clicker running on :${port}'))"`,
    client_script: clientScript,
    commands: { next: curlNext, prev: curlPrev, goto: curlGoto },
    hint: `Embed client_script in your presentation HTML inside a <script> tag, then start the server and use curl commands or any HTTP client to control slides.`,
  });
}

export function setupCollab(args: {
  design_path: string;
  port?: number;
  project_path?: string;
}): ToolResult {
  const op = 'setup_collab';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');

  const port = args.port ?? 3738;

  return okResult(op, {
    design_path: dPath,
    port,
    server_start_command: `node -e "const{startCollabServer}=require('./dist/collab/collab-server');startCollabServer({design_path:'${dPath}',port:${port}}).then(s=>console.log('Collab server on :'+s.port))"`,
    endpoints: {
      events: `http://localhost:${port}/events`,
      design: `http://localhost:${port}/design`,
      patch:  `http://localhost:${port}/patch`,
    },
    hint: 'Start the collab server, then connect any client to /events (SSE) to receive design-changed events. POST to /patch with {content:"<yaml>"} to push changes.',
  });
}
