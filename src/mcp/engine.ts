// §14 — pure domain logic, zero MCP imports
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page, ComponentSpec } from '../schema/types';
import type { ToolResult } from './types';
import { BUILTIN_THEMES } from '../themes/builtin';
import { Resvg } from '@resvg/resvg-js';
import { jsPDF } from 'jspdf';
import type { ProgressItem } from './types';
import { validateDesignSpec } from '../schema/validator';
import { validateReport, type ReportDiagnostic } from '../report/report-validator';
import { computeGroupAgg, type GroupAggOp } from '../report/aggregator';
import { exportAsTemplate, injectIntoTemplate, listSlots } from '../schema/template';
import type { TemplateSpec } from '../schema/template';
import {
  resolveDesignPath, resolveProjectPath, snapshot, readYAML, writeYAML,
  generateId, errResult, okResult, LIMITS,
  pOk, pWarn, pInfo,
  buildContext, buildHandover,
} from './engine/utils';
import { buildGuide } from './engine/guide';
import { resvgFontOption, unbundledFonts } from './engine/fonts';
export { extractReference } from './engine/reference';
export { enrichBrief } from './engine/enrich';
import { lintComposition, reviewComposition } from './engine/design-lint';
import { analyzeLayers, type Finding } from './engine/diagnose';
import { buildEditorLink, buildReportViewLink } from './engine/editor-link';
import { bareNameSegment } from './normalize-paths';
import { renderToSVGString } from './engine/svg-export';
import { expandShorthandLayers, coerceShorthandLayers, recoverStringifiedPreset, diagnoseLayers, diagnoseShorthandKeys } from './shorthand-parser';
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
  // Guard the required args with actionable messages — a small model that omits
  // project_path (or passes it as `path`) would otherwise hit a raw
  // path.join(undefined) crash and tend to hallucinate a fake result.
  if (!args.project_path) return errResult(op, 'create_design needs project_path', 'Pass project_path = the project name (e.g. "ai-poster"). Run create_project first, then reuse the path it returns.', progress);
  if (!args.name) return errResult(op, 'create_design needs a name', 'Pass name = the design name (e.g. "hero").', progress);
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
    theme: { ref: args.theme_ref ?? 'editorial-cream' },
    ...(type === 'carousel' ? { pages: [] } : { layers: [] }),
  };

  writeYAML(designPath, spec);
  progress.push(pOk(`Created ${type} scaffold`, path.basename(designPath)));

  // Self-contained editor link (fresh token) — design is openable immediately.
  const link = buildEditorLink(designPath);
  progress.push(pOk('Editor link', link.short_url ?? link.open_url));

  const projectPath = path.join(args.project_path, 'project.yaml');
  const next_action: NextAction = type === 'carousel' ? {
    tool: 'append_page', params: { design_path: designPath, page_id: 'page_1', label: 'Page 1' },
    remaining: 1, hint: 'Add pages with append_page (repeat per page), then seal_design.',
  } : {
    tool: 'add_layers', params: { design_path: designPath },
    remaining: 1, hint: 'Add content with add_layers. Design like a human, NOT an AI template: flat solid canvas (warm #FAF5EC or near-black #0A0A0A — NO gradient), a headline 4–5× the body in a real display font (set font: e.g. "Playfair Display"/"Anton"), ONE accent color, asymmetric left-anchor + whitespace, depth via a thin rule not glows. CARDS/features → ONE feature_grid layer ({type:"feature_grid", title, subtitle, bg:"#0A0A0A", accent:"#FF3D00", items:[{icon,title,desc}]}); don\'t hand-place card coordinates. Then seal_design.',
  };

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
    const handover = buildHandover('DESIGN', { design_path: designPath, project_path: args.project_path }, { type: type as 'poster' | 'carousel' });
    return okResult(op, { design_id: spec.meta.id, path: designPath, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, next_action, progress, context, handover, _attachments: [link.attachment] }, bak);
  }
  const context = buildContext(op, `Created ${type} design "${args.name}"`, [
    { type: 'design', path: designPath, role: 'created' },
  ]);
  const handover = buildHandover('DESIGN', { design_path: designPath, project_path: args.project_path }, { type: type as 'poster' | 'carousel' });
  return okResult(op, { design_id: spec.meta.id, path: designPath, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, next_action, progress, context, handover, _attachments: [link.attachment] });
}

// ── Tier 1 — Project Management ──────────────────────────────

export function createProject(args: { name: string; path?: string; theme?: string; canvas?: string }): ToolResult {
  const op = 'create_project';
  const progress: ProgressItem[] = [];
  // `path` is optional: a small model shouldn't have to know the container
  // layout. When omitted, fall back to the name as a bare segment (same
  // transform normalizeProjectPaths applies to a bare project_path, so both
  // tools map the same name to the same dir) — resolveProjectPath then places
  // it under FOLIO_PROJECTS_DIR, the only root the editor serves.
  const requestedPath = args.path ?? bareNameSegment(args.name);
  let projectDir: string;
  try {
    // resolveProjectPath accepts:
    //  - bare names ("my-project")           → FOLIO_PROJECTS_DIR/my-project
    //  - absolute paths under allowed roots  → unchanged
    //  - ~ paths                             → expanded
    projectDir = resolveProjectPath(requestedPath);
  } catch (e) {
    return errResult(op, (e as Error).message, `Just pass a bare project name (e.g. "${args.name}") — the engine places it in the projects dir. Don't build absolute /home/... paths.`);
  }
  if (fs.existsSync(projectDir)) {
    // Idempotent: if the dir already holds a valid project.yaml, treat as
    // success so the LLM can re-run the same prompt without manual cleanup.
    // Only block when the dir exists but is NOT a Folio project.
    const projectYaml = path.join(projectDir, 'project.yaml');
    if (fs.existsSync(projectYaml)) {
      progress.push(pOk('Project already exists — reusing', projectDir));
      const existing = readYAML<{ meta?: { id?: string }; config?: { default_canvas?: string } }>(projectYaml);
      const context = buildContext(op, `Reused existing project at ${projectDir}`, [
        { type: 'project', path: projectDir, role: 'reused' },
      ]);
      const handover = buildHandover('PROJECT', { project_path: projectDir });
      return okResult(op, {
        project_id: existing.meta?.id ?? 'unknown',
        path: projectDir,
        canvas: existing.config?.default_canvas,
        reused: true,
        progress, context, handover,
      });
    }
    return errResult(op, `Directory already exists but is not a Folio project: ${projectDir}`, 'Choose a different path or delete the existing directory.', progress);
  }

  const [width, height] = (args.canvas ?? '1080x1080').split('x').map(Number);
  for (const dir of ['themes','components','templates','designs','assets/fonts','assets/icons','assets/images','exports']) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
  progress.push(pOk('Created project directories', projectDir));

  // Default to a flat, art-directed EDITORIAL theme (warm cream + terracotta,
  // serif display) — not the old dark-navy + magenta + glow "Dark Tech", which
  // is the canonical AI-template look. Write the chosen builtin verbatim.
  const themeId = args.theme && BUILTIN_THEMES[args.theme] ? args.theme : 'editorial-cream';
  const theme = BUILTIN_THEMES[themeId];
  writeYAML(path.join(projectDir, `themes/${themeId}.theme.yaml`), theme);
  progress.push(pInfo('Wrote default theme', `${themeId}.theme.yaml`));

  const id = generateId();
  const today = new Date().toISOString().split('T')[0];
  const project = {
    _protocol: 'project/v1',
    meta: { id, name: args.name, version: '1.0.0', created: today, modified: today },
    config: { default_theme: themeId, default_canvas: `${width}x${height}`, default_export_format: 'png' },
    themes: [{ id: themeId, path: `themes/${themeId}.theme.yaml`, active: true }],
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
  const project = readYAML<{ themes: { id: string }[] }>(projectPath);
  const themes = project.themes ?? [];
  const seededIds = new Set(themes.map(t => t.id));
  // Surface builtin themes that aren't yet seeded so the agent knows the
  // full menu — apply_theme will auto-write them on demand.
  const available_builtins = Object.keys(BUILTIN_THEMES).filter(id => !seededIds.has(id));
  progress.push(pOk(`Found ${themes.length} theme(s) on disk, ${available_builtins.length} builtin(s) available on demand`));
  const context = buildContext(op, `Listed ${themes.length} theme(s)`);
  const handover = buildHandover('PROJECT', { project_path: args.project_path });
  return okResult(op, { themes, available_builtins, progress, context, handover });
}

export function applyTheme(args: { project_path: string; theme_id: string }): ToolResult {
  const op = 'apply_theme';
  const progress: ProgressItem[] = [];
  const projectPath = path.join(args.project_path, 'project.yaml');
  if (!fs.existsSync(projectPath)) return errResult(op, `Project not found: ${projectPath}`, 'Run create_project first.');

  const project = readYAML<{ config: { default_theme: string }; themes: { id: string; path?: string; active: boolean }[]; designs: unknown[] }>(projectPath);
  const themes = project.themes ?? [];
  let themeEntry = themes.find(t => t.id === args.theme_id);

  // Auto-seed builtin themes: an LLM agent can request any of the 14 builtins
  // even if the project was created with only the default seeded. Lazily
  // write the YAML and register it in project.themes before activation.
  if (!themeEntry && BUILTIN_THEMES[args.theme_id]) {
    const themeDir = path.join(args.project_path, 'themes');
    fs.mkdirSync(themeDir, { recursive: true });
    const relPath = `themes/${args.theme_id}.theme.yaml`;
    const absPath = path.join(args.project_path, relPath);
    writeYAML(absPath, BUILTIN_THEMES[args.theme_id]);
    themeEntry = { id: args.theme_id, path: relPath, active: false };
    themes.push(themeEntry);
    project.themes = themes;
    progress.push(pOk(`Seeded builtin theme "${args.theme_id}"`, relPath));
  }

  if (!themeEntry) {
    const available = [...themes.map(t => t.id), ...Object.keys(BUILTIN_THEMES)];
    return errResult(op, `Theme not found: ${args.theme_id}`, `Available: ${available.join(', ')}`, progress);
  }

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
  progress.push(pOk(`Guide section: ${section}`, 'sections: quick_ref | shorthand | layers | workflow | reference'));
  const context = buildContext(op, `Loaded guide section "${section}"`);
  const handover = buildHandover('PROJECT', {});
  return okResult(op, { section, guide, sections_available: 'quick_ref | shorthand | layers | workflow | reference', progress, context, handover });
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
    designPath, theme: args.theme ?? 'editorial-cream', pages: args.pages,
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

/** Every layer id already present in the design (pages + top-level + nested). */
function collectLayerIds(spec: DesignSpec): Set<string> {
  const ids = new Set<string>();
  const visit = (ls?: Layer[]): void => {
    for (const l of ls ?? []) {
      if (l?.id) ids.add(l.id);
      const o = l as unknown as Record<string, unknown>;
      if (Array.isArray(o['layers'])) visit(o['layers'] as Layer[]);
      if (Array.isArray(o['tabs'])) for (const t of o['tabs'] as Record<string, unknown>[]) visit(t['layers'] as Layer[] | undefined);
      if (Array.isArray(o['items'])) for (const it of o['items'] as Record<string, unknown>[]) visit(it['layers'] as Layer[] | undefined);
    }
  };
  for (const p of spec.pages ?? []) visit(p.layers);
  visit(spec.layers);
  return ids;
}

/** Rename incoming ids that collide with `used` (and each other) so the design
 *  never grows duplicate ids — the corruption behind charts/selection breaking
 *  when separate add_layers batches each restart numbering (rect_1, text_2…). */
function dedupeIncomingIds(incoming: Layer[], used: Set<string>): string[] {
  const renamed: string[] = [];
  for (const l of incoming) {
    if (!l?.id) continue;
    if (used.has(l.id)) {
      let n = 2, nid = `${l.id}-${n}`;
      while (used.has(nid)) nid = `${l.id}-${++n}`;
      renamed.push(`${l.id} → ${nid}`);
      l.id = nid;
    }
    used.add(l.id);
  }
  return renamed;
}

/** Fold tolerated field aliases to canonical names so the stored YAML is valid
 *  and renders everywhere. LLMs reach for the natural short name; the renderers
 *  read the schema name. Normalize on write so charts/callouts aren't silently
 *  blank. callout body: `text`→`content`; chart: `chart`→`chart_type`, and a
 *  STRING `x`/`y` (a field name, not a pixel position) → `x_field`/`y_field`. */
function normalizeReportAliases(incoming: Layer[]): void {
  for (const l of incoming) {
    const o = l as unknown as Record<string, unknown>;
    if (l.type === 'callout' && o['content'] == null && o['text'] != null) {
      o['content'] = o['text'];
      delete o['text'];
    }
    if (l.type === 'interactive_chart') {
      if (o['chart_type'] == null && typeof o['chart'] === 'string') { o['chart_type'] = o['chart']; delete o['chart']; }
      if (o['chart_type'] == null && typeof o['kind'] === 'string') { o['chart_type'] = o['kind']; delete o['kind']; }
      if (o['x_field'] == null && typeof o['x'] === 'string') { o['x_field'] = o['x']; delete o['x']; }
      if (o['y_field'] == null && typeof o['y'] === 'string') { o['y_field'] = o['y']; delete o['y']; }
    }
    if (l.type === 'interactive_table' && Array.isArray(o['columns'])) {
      for (const col of o['columns'] as Record<string, unknown>[]) {
        if (col && col['title'] == null) {
          const alias = col['label'] ?? col['header'] ?? col['name'];
          if (alias != null) col['title'] = alias;
        }
      }
    }
  }
}

// Snap a top-level shorthand layer's declared box into the page canvas. Reads
// the two shapes the engine accepts — `pos:[x,y,w,h]` or `x/y/width/height` —
// and shrinks only the dimension(s) that spill past the right/bottom edge. A
// model that mistypes a portrait height (1350) onto a square doc (1080) gets a
// canvas-fitting preset instead of a clipped, un-fixable one.
function clampShorthandToCanvas(layers: ShorthandLayer[], W: number, H: number): void {
  if (!(W > 0) || !(H > 0)) return;
  for (const sh of layers) {
    const r = sh as Record<string, unknown>;
    const p = r['pos'];
    if (Array.isArray(p) && p.length >= 4 && p.slice(0, 4).every(n => typeof n === 'number')) {
      const [x, y, w, h] = p as number[];
      r['pos'] = [x, y, x + w > W ? Math.max(1, W - x) : w, y + h > H ? Math.max(1, H - y) : h];
      continue;
    }
    const x = typeof r['x'] === 'number' ? (r['x'] as number) : 0;
    const y = typeof r['y'] === 'number' ? (r['y'] as number) : 0;
    if (typeof r['width'] === 'number' && x + (r['width'] as number) > W) r['width'] = Math.max(1, W - x);
    if (typeof r['height'] === 'number' && y + (r['height'] as number) > H) r['height'] = Math.max(1, H - y);
  }
}

export function addLayers(args: {
  design_path: string; page_id?: string; project_path?: string;
  layers?: Layer[]; layers_shorthand?: ShorthandLayer[]; task_path?: string;
}): ToolResult {
  const op = 'add_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  // Coerce the many shapes a small model sends (array of objects, array of
  // compact strings, or a {id: "type:[pos]:text"} dict) into canonical layers.
  const rawShorthand = args.layers_shorthand as unknown;
  // coerceShorthandLayers leniently parses a JSON/YAML-array STRING (a common
  // small-model form) back into layers. Only when that parse yields NOTHING do
  // we surface the helpful shape — e.g. a flat blob ("feature_grid:0,0,…:title=…")
  // with no [x,y,w,h] bracket that coerces to nothing.
  let shorthand = coerceShorthandLayers(rawShorthand);
  if (typeof rawShorthand === 'string' && !shorthand.length) {
    return errResult(op,
      'layers_shorthand was a STRING that did not parse into any layers.',
      'Send a JSON array. Feature/benefit/cards poster → one feature_grid (flat bg + one accent, not a gradient): layers_shorthand=[{type:"feature_grid", title:"Brew Lab", subtitle:"Premium coffee subscription", bg:"#0A0A0A", accent:"#FF3D00", text_color:"#FAFAFA", items:[{icon:"coffee", title:"Freshly Roasted", desc:"Sourced from sustainable farms"},{icon:"truck", title:"Fast Delivery", desc:"Shipped within 24h"},{icon:"shield-check", title:"Quality Assured", desc:"Third-wave control"}]}]');
  }
  if (!args.layers?.length && !shorthand.length) return errResult(op, 'No layers provided', 'Pass layers or a layers_shorthand array/object.');
  // A weak model sometimes packs the ENTIRE preset as a STRINGIFIED JSON blob
  // inside a verbose text layer (`content.value`) instead of passing it as
  // layers_shorthand — the engine then renders one unreadable JSON wall → a
  // blank-looking poster. Recover the preset and re-route it through the
  // shorthand expander (same silent-drop class as a stringified shorthand, #42).
  if (!shorthand.length && args.layers?.length) {
    const recovered = recoverStringifiedPreset(args.layers);
    if (recovered?.length) {
      shorthand = recovered;
      progress.push(pInfo('Recovered a stringified preset from a text layer', `re-expanding ${recovered.length} preset layer(s)`));
    }
  }

  const spec = readYAML<DesignSpec>(dPath);
  // Clamp any top-level layer the model sized larger than the canvas BEFORE
  // expansion. A full-bleed preset given height 1350 on a 1080 doc expands to a
  // group + bg taller than the page → off_canvas error the model then can't fix
  // (patching the already-EXPANDED group's shorthand keys is inert). Clamping at
  // the source lets the preset lay itself out correctly inside the page.
  if (shorthand.length) clampShorthandToCanvas(shorthand, spec.document.width, spec.document.height);

  const incoming: Layer[] = shorthand.length
    ? expandShorthandLayers(shorthand)
    : (args.layers ?? []);
  progress.push(pInfo(`Expanding ${incoming.length} layer(s)`, shorthand.length ? 'via shorthand' : 'verbose'));

  const invalid = incoming.find(l => !l?.type || !VALID_LAYER_TYPES.has(l.type));
  if (invalid) {
    return errResult(
      op,
      `Invalid layer.type: "${invalid.type}" (id: ${invalid.id ?? '?'})`,
      `Allowed: ${[...VALID_LAYER_TYPES].join(', ')}`,
    );
  }
  // Catch dimension omissions early — silently-invisible layers are the
  // single most common LLM authoring failure mode in verbose mode.
  for (const l of incoming) {
    const dimMsg = dimError(l);
    if (dimMsg) return errResult(op, dimMsg, 'Pass explicit width + height (px) on every sized layer, or use pos:[x,y,w,h] shorthand.');
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));

  // Canonicalize aliases, then guarantee globally-unique ids before insert.
  normalizeReportAliases(incoming);
  const renamed = dedupeIncomingIds(incoming, collectLayerIds(spec));
  if (renamed.length) progress.push(pInfo(`Renamed ${renamed.length} colliding id(s)`, renamed.slice(0, 8).join(', ')));

  // Routing: a paged design (report/carousel) keeps content in pages[]. Never
  // silently spill into a divergent top-level layers[] — that splits the canvas
  // from the editor and hides half the report. Default to the sole page.
  const pages = spec.pages;
  let activeLayers: Layer[] = incoming;
  if (pages && pages.length) {
    const pageId = args.page_id ?? (pages.length === 1 ? pages[0].id : undefined);
    if (!pageId) return errResult(op, `Design has ${pages.length} pages — pass page_id to say which one`, `Pages: ${pages.map(p => p.id).join(', ')}`, progress);
    const page = pages.find(p => p.id === pageId);
    if (!page) return errResult(op, `Page not found: ${pageId}`, `Pages: ${pages.map(p => p.id).join(', ')}`, progress);
    if (!args.page_id && pages.length === 1) progress.push(pInfo('Routed to the only page', pageId));
    if (!page.layers) page.layers = [];
    page.layers.push(...incoming);
    activeLayers = page.layers;
  } else {
    if (!spec.layers) spec.layers = [];
    const hadContent = spec.layers.length > 0;
    spec.layers.push(...incoming);
    activeLayers = spec.layers;
    // Auto-fit the canvas to a fresh single full-bleed preset. A flow preset
    // (sections/stat/…) has already sized its group to its own content — short
    // → shorter page (no dead band), long → taller page (no clipping). Match
    // the document height to it so the poster has no wasted space and nothing
    // spills off the bottom. Only when this preset IS the whole poster.
    if (!hadContent && incoming.length === 1) {
      const g = incoming[0] as Layer & { x?: number; width?: number; height?: number };
      const W = spec.document.width;
      if (g.type === 'group' && (g.x ?? 0) <= W * 0.02 && (g.width ?? 0) >= W * 0.9 && typeof g.height === 'number' && g.height > 0) {
        spec.document.height = g.height;
      }
    }
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Added ${incoming.length} layer(s)`, incoming.map(l => l.id).join(', ')));

  const lint = lintComposition(activeLayers, spec.document.width, spec.document.height);
  // Quality critic — advisory; only when the page looks "complete" (the full
  // poster has been composed, not a 2-layer partial), so we guide, not nag.
  const review = activeLayers.length >= 6
    ? reviewComposition(activeLayers, spec.document.width, spec.document.height)
    : [];
  const notes = [...(shorthand.length ? diagnoseShorthandKeys(shorthand) : []), ...diagnoseLayers(incoming), ...lint, ...review];
  for (const n of notes) progress.push(pInfo('Layer note', n));
  // Report cross-reference diagnostics (charts→datasets, buttons→modals, …) so
  // the LLM building the report sees broken refs immediately, not at export.
  const diagnostics = spec.meta.type === 'report' ? validateReport(spec) : [];
  for (const d of diagnostics) progress.push(pWarn(`[${d.code}] ${d.message}`, d.fix));
  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: 0, hint: notes.length ? `Layers added with ${notes.length} note(s) to address — see notes — then seal_design.` : 'Layers added. Call seal_design or add more layers.' };
  const context = buildContext(op, `Added ${incoming.length} layer(s) to ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, ...(args.task_path ? { task_path: args.task_path } : {}) });
  return okResult(op, { added: incoming.length, layer_ids: incoming.map(l => l.id), ...(notes.length ? { notes } : {}), ...(diagnostics.length ? { diagnostics } : {}), next_action, progress, context, handover }, bak);
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

  const pageShorthand = coerceShorthandLayers(args.layers_shorthand as unknown);
  const layers: Layer[] = pageShorthand.length
    ? expandShorthandLayers(pageShorthand)
    : (args.layers ?? []);
  // Never silently append an EMPTY page when content was MEANINGFULLY supplied
  // but coerced to nothing (e.g. a stringified shorthand that didn't parse) — a
  // blank slide would still report success and the dropped copy goes unnoticed,
  // exactly how a 6-page carousel sealed with every page empty. An explicit
  // `layers: []` / `layers_shorthand: []` scaffold call stays allowed.
  const rawSh = args.layers_shorthand as unknown;
  const shorthandSupplied =
    (typeof rawSh === 'string' && rawSh.trim().length > 0) ||
    (Array.isArray(rawSh) && rawSh.length > 0) ||
    (rawSh != null && typeof rawSh === 'object' && !Array.isArray(rawSh) && Object.keys(rawSh as object).length > 0);
  if (layers.length === 0 && shorthandSupplied) {
    return errResult(op,
      'append_page produced 0 layers — the page content did not parse, so nothing was written.',
      'Pass layers_shorthand as an ARRAY of preset objects (ONE per slide), e.g. layers_shorthand=[{type:"editorial", bg:"#FAF5EC", accent:"#B8543C", text_color:"#1A1A1A", kicker:"…", title:"…", deck:"…"}].', progress);
  }
  progress.push(pInfo(`Page has ${layers.length} layer(s)`, pageShorthand.length ? 'via shorthand' : 'verbose'));

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

  const notes = [...(pageShorthand.length ? diagnoseShorthandKeys(pageShorthand) : []), ...diagnoseLayers(layers)];
  for (const n of notes) progress.push(pInfo('Layer note', n));

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
  }, { type: 'carousel' });
  const link = buildEditorLink(dPath, { page: spec.pages.length - 1 });
  return okResult(op, { page_id: pageId, page_count: spec.pages.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(notes.length ? { notes } : {}), ...(next_action ? { next_action } : {}), progress, context, handover, _attachments: [link.attachment] }, bak);
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
      if (setNestedValue(spec, sel.path, sel.value)) wouldPatch.push(sel.path);
      else errors.push(`${sel.path}: path did not resolve (missing parent, out-of-range index, or no filter match)`);
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
  const unresolved: string[] = [];
  const inert: string[] = [];
  for (const sel of args.selectors) {
    if (setNestedValue(spec, sel.path, sel.value)) {
      patched.push(sel.path);
      const w = inertPresetKeyWarning(spec, sel.path);
      if (w) inert.push(w);
    } else {
      unresolved.push(sel.path);
    }
  }
  // Every selector missed — almost always `layers[0].x` against a design whose
  // shape the model guessed wrong. Fail loudly instead of reporting a phantom
  // success the model can't see through (it has no render).
  if (patched.length === 0 && unresolved.length > 0) {
    return errResult(op,
      `None of the ${unresolved.length} patch path(s) resolved: ${unresolved.join(', ')}`,
      'Run inspect_design first to read exact paths. Layers are addressable by index (layers[0].x) or id filter (layers[id=foo].x).',
      progress);
  }
  writeYAML(dPath, spec);
  progress.push(pOk(`Patched ${patched.length} field(s)`, patched.join(', ')));
  if (unresolved.length) progress.push(pWarn(`${unresolved.length} path(s) did not resolve — not applied`, unresolved.join(', ')));
  for (const w of inert) progress.push(pWarn('Patch has no render effect', w));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: inert.length ? 'Some patches hit an expanded preset (no effect) — remove_layer + add_layers to change it. Otherwise seal_design.' : 'Fields patched. Call seal_design or make further patches.' };
  const context = buildContext(op, `Patched ${patched.length} field(s) in ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { patched_paths: patched, count: patched.length, ...(unresolved.length ? { unresolved } : {}), ...(inert.length ? { inert_no_effect: inert } : {}), next_action, progress, context, handover }, bak);
}

export function sealDesign(args: { design_path: string; project_path?: string }): ToolResult {
  const op = 'seal_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  // Never seal a blank poster. A weak model that thrashed (hallucinated tool
  // names, looped) can reach seal_design with layers:[] — sealing then ships an
  // empty design. Refuse, and point it back at add_layers so it produces output.
  // (Carousels have a `pages` key and their own page-completion flow — skip them.)
  if (!spec.pages && (spec.layers?.length ?? 0) === 0) {
    return errResult(op, 'Cannot seal an empty design — the canvas has no layers.',
      'Call add_layers FIRST with ONE preset layer (use the prefixed tool name mcp__folio__add_layers), e.g. layers_shorthand:[{type:"sections", title:"…", subtitle:"…", bg_style:"…", blocks:[…]}]; then diagnose_design; then seal_design.', progress);
  }
  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  spec._mode = 'complete';
  if (spec.meta.generation) spec.meta.generation.status = 'complete';
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk('Design sealed', `${spec.pages?.length ?? 0} page(s), ${spec.layers?.length ?? 0} root layer(s)`));

  const link = buildEditorLink(dPath);
  progress.push(pOk('Editor link', link.short_url ?? link.open_url));
  // Hand the SHORT link to the user — a small model mangles the long tokenized
  // URL (truncates / re-encodes it). share_url is ~40 chars and copy-safe.
  const next_action: NextAction = { tool: 'export_design', params: { design_path: dPath, format: 'svg' }, remaining: 0, hint: `Export with export_design. To open or share the design, give the user this link EXACTLY as written (do not retype or re-encode it): ${link.short_url ?? link.open_url}` };
  const context = buildContext(op, `Sealed design "${spec.meta.name}"`, [
    { type: 'design', path: dPath, role: 'sealed' },
  ]);
  const handover = buildHandover('SEAL', { design_path: dPath }, { type: spec.meta.type });
  return okResult(op, { status: 'sealed', pages: spec.pages?.length ?? 0, layers: spec.layers?.length ?? 0, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, next_action, progress, context, handover, _attachments: [link.attachment] }, bak);
}

// Known layer types — kept in sync with LayerType in src/schema/types.ts.
// Used to reject garbage like type:"frobozz" before it lands on disk.
const VALID_LAYER_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line',
  'text', 'image', 'icon', 'component', 'component_list',
  'mermaid', 'chart', 'code', 'math', 'group', 'qrcode',
  'auto_layout', 'interactive_chart', 'interactive_table',
  'rich_text', 'kpi_card', 'map', 'embed_code', 'popup', 'particle',
  'button', 'tabs', 'accordion', 'filter_bar', 'toggle',
  'tooltip', 'callout', 'progress',
]);

// Layer types that render INVISIBLY when width or height is 0 / missing.
// LLM agents commonly omit these in verbose form, producing a blank canvas
// that no test catches. Reject at write time with an actionable error so
// the agent fixes the YAML immediately instead of debugging from the SVG.
const SIZED_LAYER_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'image', 'icon', 'group',
  'chart', 'interactive_chart', 'interactive_table', 'rich_text', 'kpi_card',
  'mermaid', 'code', 'math', 'qrcode', 'map', 'embed_code',
]);

function dimError(l: Layer): string | null {
  if (!SIZED_LAYER_TYPES.has(l.type)) return null;
  // Flow-report layers are positioned by `span` (responsive grid), not px dimensions.
  const span = (l as Layer & { span?: number }).span;
  if (typeof span === 'number' && span > 0) return null;
  const w = (l as Layer & { width?: number }).width;
  const h = (l as Layer & { height?: number }).height;
  // pos:[x,y,w,h] shorthand still pending expansion — accept it.
  const pos = (l as Layer & { pos?: number[] }).pos;
  if (Array.isArray(pos) && pos.length >= 4 && pos[2] && pos[3]) return null;
  if (typeof w !== 'number' || w <= 0) return `Layer "${l.id}" (${l.type}) needs a positive width — got ${w}`;
  if (typeof h !== 'number' || h <= 0) return `Layer "${l.id}" (${l.type}) needs a positive height — got ${h}`;
  return null;
}

export function addLayer(args: { design_path: string; page_id?: string; layer: Layer; project_path?: string }): ToolResult {
  const op = 'add_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  if (!args.layer || !args.layer.type || !VALID_LAYER_TYPES.has(args.layer.type)) {
    return errResult(
      op,
      `Invalid layer.type: "${args.layer?.type}"`,
      `Allowed: ${[...VALID_LAYER_TYPES].join(', ')}`,
    );
  }
  const dimMsg = dimError(args.layer);
  if (dimMsg) return errResult(op, dimMsg, 'Pass explicit width + height (px) or use pos:[x,y,w,h] shorthand.');

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

// Which scopes (root + page ids) carry a top-level layer with this id. >1 means
// an unscoped remove/update would hit multiple pages — carousel preset groups
// share ids (sections_1 / editorial_1), so this guards the silent-nuke footgun.
function pagesWithLayer(spec: DesignSpec, layerId: string): string[] {
  const hits: string[] = [];
  if (spec.layers?.some(l => l.id === layerId)) hits.push('(root)');
  for (const p of spec.pages ?? []) if (p.layers?.some(l => l.id === layerId)) hits.push(p.id);
  return hits;
}

export function updateLayer(args: { design_path: string; layer_id: string; props: Partial<Layer>; page_id?: string; project_path?: string }): ToolResult {
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

  // page_id scopes the edit to ONE carousel page — without it the same id on
  // sibling pages would all be patched (carousel groups share ids).
  if (args.page_id) {
    const page = spec.pages?.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Use inspect_design to list page IDs.', progress);
    if (page.layers) page.layers = patch(page.layers);
  } else {
    const hits = pagesWithLayer(spec, args.layer_id);
    if (hits.length > 1) return errResult(op, `Layer id "${args.layer_id}" exists on ${hits.length} pages (${hits.join(', ')}) — refusing to patch all of them.`, 'Pass page_id to update ONE page (carousel pages share layer IDs).', progress);
    if (spec.layers) spec.layers = patch(spec.layers);
    if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = patch(page.layers); }
  }
  if (!found) return errResult(op, `Layer not found: ${args.layer_id}`, 'Use inspect_design to find layer IDs.', progress);

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Updated layer "${args.layer_id}"`, Object.keys(args.props).join(', ')));

  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: -1, hint: 'Continue editing or call seal_design.' };
  const context = buildContext(op, `Updated layer "${args.layer_id}" in ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { updated: args.layer_id, next_action, progress, context, handover }, bak);
}

export function removeLayer(args: { design_path: string; layer_id: string; page_id?: string; project_path?: string }): ToolResult {
  const op = 'remove_layer';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const spec = readYAML<DesignSpec>(dPath);
  let removed = 0;
  const drop = (layers: Layer[]): Layer[] => { const k = layers.filter(l => l.id !== args.layer_id); removed += layers.length - k.length; return k; };
  // page_id scopes removal to ONE carousel page. WITHOUT it the same id on
  // sibling pages is removed too (carousel groups share ids) — the footgun that
  // silently emptied 3 pages when one page's group was deleted by id.
  if (args.page_id) {
    const page = spec.pages?.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Use inspect_design to list page IDs.', progress);
    if (page.layers) page.layers = drop(page.layers);
  } else {
    const hits = pagesWithLayer(spec, args.layer_id);
    if (hits.length > 1) return errResult(op, `Layer id "${args.layer_id}" exists on ${hits.length} pages (${hits.join(', ')}) — refusing to remove from all (this silently empties sibling slides).`, 'Pass page_id to remove it from ONE page (carousel pages share layer IDs).', progress);
    if (spec.layers) spec.layers = drop(spec.layers);
    if (spec.pages) for (const page of spec.pages) { if (page.layers) page.layers = drop(page.layers); }
  }
  if (removed === 0) return errResult(op, `Layer not found: ${args.layer_id}`, args.page_id ? `No layer "${args.layer_id}" on page "${args.page_id}".` : 'Use inspect_design to find layer IDs.', progress);

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Removed layer "${args.layer_id}"`, removed > 1 ? `${removed} matches across pages — pass page_id to scope` : undefined));

  const next_action: NextAction = { tool: 'inspect_design', params: { design_path: dPath }, remaining: -1, hint: 'Verify removal with inspect_design, then continue or seal.' };
  const context = buildContext(op, `Removed layer "${args.layer_id}" from ${path.basename(dPath)}`);
  const handover = buildHandover('PATCH', { design_path: dPath });
  return okResult(op, { removed: args.layer_id, next_action, progress, context, handover }, bak);
}

// ── Tier 3 — Export & Templates ──────────────────────────────

// Blank image srcs pointing at a local file we can't find, so the renderer
// shows its placeholder frame instead of a blank gap on export. Mutates the
// (export-only, non-persisted) spec and returns a note per blanked layer so
// the caller can tell the model to fix the asset. Skips http(s)/data/file URIs.
function flagMissingImages(spec: DesignSpec, baseDirs: string[]): string[] {
  const notes: string[] = [];
  const dirs = baseDirs.filter(Boolean);
  const visit = (layers: Layer[] | undefined): void => {
    for (const l of layers ?? []) {
      if (l.type === 'image') {
        const img = l as Layer & { src?: string };
        const src = img.src;
        if (typeof src === 'string' && src.trim() && !/^(https?:|data:|file:|\/\/)/i.test(src)) {
          const found = dirs.some(d => { try { return fs.existsSync(path.resolve(d, src)); } catch { return false; } });
          if (!found) {
            img.src = '';
            notes.push(`image "${l.id}": asset "${src}" not found — exported as a placeholder frame. Use a real file path, an https:// URL, or swap it for a fill/shape/icon.`);
          }
        }
      }
      if (l.type === 'group') visit((l as Layer & { layers?: Layer[] }).layers);
    }
  };
  visit(spec.layers);
  for (const p of spec.pages ?? []) visit((p as Page & { layers?: Layer[] }).layers);
  return notes;
}

// Load the project's saved components into a registry so `type:component`
// layers resolve during export (the renderer needs componentRegistry; without
// it a component renders empty). Best-effort — returns undefined on any miss.
function loadComponentRegistry(projectDir: string | undefined): Map<string, ComponentSpec> | undefined {
  if (!projectDir) return undefined;
  const indexPath = path.join(projectDir, 'components/index.yaml');
  if (!fs.existsSync(indexPath)) return undefined;
  try {
    const index = readYAML<{ components?: { id: string; path: string }[] }>(indexPath);
    const reg = new Map<string, ComponentSpec>();
    for (const entry of index.components ?? []) {
      const cPath = path.join(projectDir, entry.path);
      if (fs.existsSync(cPath)) reg.set(entry.id, readYAML<ComponentSpec>(cPath));
    }
    return reg.size ? reg : undefined;
  } catch { return undefined; }
}

/**
 * Collect absolute-positioned clickable rects from every layer carrying an
 * `href` (recursing into groups — group children are stored in absolute
 * coords). Used to add PDF `/Link` annotations over hyperlinked layers.
 */
export function collectHrefRects(layers: Layer[]): { x: number; y: number; w: number; h: number; href: string }[] {
  const out: { x: number; y: number; w: number; h: number; href: string }[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      const href = (l as { href?: unknown }).href;
      const g = l as { x?: number; y?: number; width?: number; height?: number; layers?: Layer[] };
      if (typeof href === 'string' && href.trim() && (g.width ?? 0) > 0 && (g.height ?? 0) > 0) {
        out.push({ x: g.x ?? 0, y: g.y ?? 0, w: g.width ?? 0, h: g.height ?? 0, href });
      }
      if (Array.isArray(g.layers)) walk(g.layers);
    }
  };
  walk(layers);
  return out;
}

export function exportDesign(args: { design_path: string; format: string; output_path?: string; scale?: number; project_path?: string }): ToolResult {
  const op = 'export_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const criticals = validateDesignSpec(spec).filter(e => e.severity === 'error');
  if (criticals.length > 0) return errResult(op, `Validation errors: ${criticals.map(e => e.message).join('; ')}`, 'Fix errors then retry.', progress);

  const assetNotes = flagMissingImages(spec, [
    path.dirname(dPath), path.dirname(path.dirname(dPath)),
    ...(args.project_path ? [args.project_path, path.join(args.project_path, 'assets')] : []),
  ]);
  for (const n of assetNotes) progress.push(pInfo('Missing asset', n));

  // Load project components so `type:component` layers resolve in the export.
  const componentRegistry = loadComponentRegistry(args.project_path ?? path.dirname(path.dirname(dPath)));

  // Carousels store their content on `pages[]`, not root `layers` — renderDesign
  // only walks root layers, so a whole-spec render of a carousel is blank. Render
  // each page as a synthetic single-page spec (its layers promoted to the root)
  // and emit one file per page. `multiPage` is false for posters/reports.
  const pages = spec.pages ?? [];
  const multiPage = pages.length > 0;
  const renderPageSVG = (page: Page): string =>
    renderToSVGString(
      { ...spec, layers: page.layers ?? [], pages: undefined } as DesignSpec,
      undefined, undefined, componentRegistry,
    );

  const outPath = args.output_path ?? dPath.replace('.design.yaml', `.${args.format}`);
  const link = buildEditorLink(dPath);
  if (args.format === 'svg') {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // Carousel → one SVG per page (`<base>-p1.svg`, `-p2.svg`, …).
      if (multiPage) {
        const base = outPath.replace(/\.svg$/i, '');
        const outPaths: string[] = [];
        const _attachments: unknown[] = [];
        let totalBytes = 0;
        pages.forEach((page, i) => {
          const svgStr = renderPageSVG(page);
          const pPath = `${base}-p${i + 1}.svg`;
          fs.writeFileSync(pPath, svgStr, 'utf-8');
          outPaths.push(pPath);
          totalBytes += svgStr.length;
          progress.push(pOk(`SVG page ${i + 1}/${pages.length}`, `${path.basename(pPath)} (${svgStr.length} bytes)`));
          _attachments.push({ type: 'image' as const, data: Buffer.from(svgStr, 'utf-8').toString('base64'), mimeType: 'image/svg+xml' });
        });
        _attachments.push(link.attachment);
        const context = buildContext(op, `SVG exported for "${spec.meta.name}" — ${outPaths.length} page(s)`, outPaths.map(p => ({ type: 'svg', path: p, role: 'output' })));
        const handover = buildHandover('EXPORT', { design_path: dPath });
        return okResult(op, { format: 'svg', pages: outPaths.length, output_files: outPaths.map(p => path.basename(p)), output_paths: outPaths, output_path: outPaths[0], status: 'ok', bytes: totalBytes, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
      }
      const svgStr = renderToSVGString(spec, undefined, undefined, componentRegistry);
      fs.writeFileSync(outPath, svgStr, 'utf-8');
      progress.push(pOk('SVG written', path.basename(outPath)));
      const context = buildContext(op, `SVG exported for "${spec.meta.name}"`, [
        { type: 'svg', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      // Attach the SVG inline so MCP-aware chat clients can preview the
      // export without opening the file. Also include a resource link to
      // the file path so file-system clients can open it locally.
      const _attachments = [
        { type: 'image' as const, data: Buffer.from(svgStr, 'utf-8').toString('base64'), mimeType: 'image/svg+xml' },
        { type: 'resource' as const, resource: { uri: `file://${outPath}`, mimeType: 'image/svg+xml', text: path.basename(outPath) } },
        link.attachment,
      ];
      return okResult(op, { format: 'svg', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: svgStr.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(assetNotes.length ? { notes: assetNotes } : {}), progress, context, handover, _attachments });
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
      // Carousel → stack every page's SVG vertically so the single HTML doc
      // shows the whole deck (whole-spec render would be blank — pages aren't
      // root layers). Poster/report keep their existing single-body render.
      const body = multiPage
        ? pages.map((page, i) => `<div class="folio-page" data-page="${i + 1}">${renderPageSVG(page)}</div>`).join('\n')
        : renderToSVGString(spec, undefined, undefined, componentRegistry);
      const html: string = spec.meta.type === 'report'
        ? assembleReportHTML(spec, datasets, {})
        : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${spec.meta.name}</title><style>body{margin:0}.folio-page{display:block;margin:0 auto}.folio-page+.folio-page{margin-top:16px}</style></head><body>${body}</body></html>`;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf-8');
      progress.push(pOk('HTML written', path.basename(outPath)));
      const context = buildContext(op, `HTML exported for "${spec.meta.name}"`, [{ type: 'html', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'html', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: html.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, handover, _attachments: [link.attachment] });
    } catch (err) {
      return errResult(op, `HTML export failed: ${(err as Error).message}`, 'Check design spec.', progress);
    }
  }
  if (args.format === 'pdf') {
    // Real PDF, in-container (no browser): rasterize each page through resvg
    // with the bundled fonts (so type matches the editor) and place it full-
    // page in a jsPDF, then add `/Link` annotations over every hyperlinked
    // layer. This is a high-resolution RASTER pdf with working links — crisp
    // at practical zoom. For selectable text / infinite-zoom vector, the SVG
    // export (now self-contained) or the hi-fi browser worker is the path.
    try {
      const scale = typeof args.scale === 'number' && args.scale > 0 ? args.scale : 3;
      const missingFonts = new Set<string>();
      const rasterize = (svgStr: string): Buffer => {
        for (const f of unbundledFonts(svgStr)) missingFonts.add(f);
        return Buffer.from(new Resvg(svgStr, {
          fitTo: { mode: 'zoom', value: scale },
          background: 'rgba(255,255,255,1)',
          font: resvgFontOption(),
        }).render().asPng());
      };
      const W = spec.document.width, H = spec.document.height;
      const toPt = (px: number): number => (px * 72) / 96;
      const orient = W >= H ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [toPt(W), toPt(H)], compress: true });
      const addDesignPage = (svgStr: string, layers: Layer[], first: boolean): void => {
        if (!first) pdf.addPage([toPt(W), toPt(H)], orient);
        const png = rasterize(svgStr);
        pdf.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 0, 0, toPt(W), toPt(H), undefined, 'FAST');
        for (const r of collectHrefRects(layers)) {
          pdf.link(toPt(r.x), toPt(r.y), toPt(r.w), toPt(r.h), { url: r.href });
        }
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (multiPage) {
        pages.forEach((page, i) => addDesignPage(renderPageSVG(page), page.layers ?? [], i === 0));
      } else {
        addDesignPage(renderToSVGString(spec, undefined, undefined, componentRegistry), spec.layers ?? [], true);
      }
      const pdfBuf = Buffer.from(pdf.output('arraybuffer'));
      fs.writeFileSync(outPath, pdfBuf);
      progress.push(pOk('PDF written', `${path.basename(outPath)} (${pdfBuf.length} bytes @ ${scale}×)`));
      const linkCount = multiPage
        ? pages.reduce((n, p) => n + collectHrefRects(p.layers ?? []).length, 0)
        : collectHrefRects(spec.layers ?? []).length;
      const notes = [
        'PDF is a high-resolution raster with clickable links and editor-matching fonts. For selectable text / infinite-zoom vector, use export_design format:"svg" (self-contained) or the hi-fi browser worker.',
        ...(missingFonts.size ? [`Fonts not bundled — fell back to a default in raster: ${[...missingFonts].join(', ')}.`] : []),
      ];
      const context = buildContext(op, `PDF exported for "${spec.meta.name}"`, [{ type: 'pdf', path: outPath, role: 'output' }]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      return okResult(op, { format: 'pdf', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: pdfBuf.length, scale, pages: multiPage ? pages.length : 1, links: linkCount, notes, progress, context, handover });
    } catch (err) {
      return errResult(op, `PDF render failed: ${(err as Error).message}`, 'Try format="png" or "svg" to isolate; PDF = resvg raster + jsPDF.', progress);
    }
  }
  if (args.format === 'png') {
    try {
      // @resvg/resvg-js is a pure-Rust SVG renderer; prebuilt binaries
      // ship for linux-x64-musl (alpine), linux-x64-gnu, darwin, win32.
      const scale = typeof args.scale === 'number' && args.scale > 0 ? args.scale : 2;
      // resvg can't fetch web fonts — it only renders fonts we hand it. Point it
      // at the bundled font directory (src/mcp/fonts, COPY'd into the image) so
      // raster output matches the editor's web-font render; DejaVu is the last
      // resort for any family we don't ship. Families a design uses but we DON'T
      // bundle are collected below and surfaced as a note (they'd silently fall
      // back to DejaVu here while rendering fine in the editor).
      const missingFonts = new Set<string>();
      // resvg's `fitTo: { mode: 'zoom' }` scales the rendered raster while
      // keeping the SVG viewBox aspect ratio.
      const rasterize = (svgStr: string): Buffer => {
        for (const f of unbundledFonts(svgStr)) missingFonts.add(f);
        return Buffer.from(new Resvg(svgStr, {
          fitTo: { mode: 'zoom', value: scale },
          background: 'rgba(0,0,0,0)',
          font: resvgFontOption(),
        }).render().asPng());
      };
      const fontNote = (): string[] =>
        missingFonts.size
          ? [`Fonts not bundled for raster export — fell back to a default in PNG/PDF (they render correctly in the editor): ${[...missingFonts].join(', ')}. Use a bundled family (e.g. Inter, Space Grotesk, Playfair Display, IBM Plex Mono) for pixel-matching export.`]
          : [];
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // Carousel → one PNG per page (`<base>-p1.png`, `-p2.png`, …).
      if (multiPage) {
        const base = outPath.replace(/\.png$/i, '');
        const outPaths: string[] = [];
        const _attachments: unknown[] = [];
        let totalBytes = 0;
        pages.forEach((page, i) => {
          const png = rasterize(renderPageSVG(page));
          const pPath = `${base}-p${i + 1}.png`;
          fs.writeFileSync(pPath, png);
          outPaths.push(pPath);
          totalBytes += png.length;
          progress.push(pOk(`PNG page ${i + 1}/${pages.length}`, `${path.basename(pPath)} (${png.length} bytes @ ${scale}×)`));
          _attachments.push({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' });
        });
        const context = buildContext(op, `PNG exported for "${spec.meta.name}" — ${outPaths.length} page(s)`, outPaths.map(p => ({ type: 'png', path: p, role: 'output' })));
        const handover = buildHandover('EXPORT', { design_path: dPath });
        return okResult(op, { format: 'png', pages: outPaths.length, output_files: outPaths.map(p => path.basename(p)), output_paths: outPaths, output_path: outPaths[0], status: 'ok', bytes: totalBytes, scale, ...((): Record<string, unknown> => { const n = [...assetNotes, ...fontNote()]; return n.length ? { notes: n } : {}; })(), progress, context, handover, _attachments });
      }
      const png = rasterize(renderToSVGString(spec, undefined, undefined, componentRegistry));
      fs.writeFileSync(outPath, png);
      progress.push(pOk('PNG written', `${path.basename(outPath)} (${png.length} bytes @ ${scale}×)`));
      const context = buildContext(op, `PNG exported for "${spec.meta.name}"`, [
        { type: 'png', path: outPath, role: 'output' },
      ]);
      const handover = buildHandover('EXPORT', { design_path: dPath });
      const _attachments = [
        { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'resource' as const, resource: { uri: `file://${outPath}`, mimeType: 'image/png', text: path.basename(outPath) } },
      ];
      return okResult(op, { format: 'png', output_file: path.basename(outPath), output_path: outPath, status: 'ok', bytes: png.length, scale, ...((): Record<string, unknown> => { const n = [...assetNotes, ...fontNote()]; return n.length ? { notes: n } : {}; })(), progress, context, handover, _attachments });
    } catch (err) {
      return errResult(op, `PNG render failed: ${(err as Error).message}`, 'Try format="svg" to verify the design renders; PNG layer = SVG layer + resvg rasterizer.', progress);
    }
  }
  return errResult(
    op,
    `Unsupported export format: ${args.format}`,
    `Supported formats: svg, png, html. PDF requires a separate Puppeteer step.`,
    progress,
  );
}

// ── diagnose_design ─────────────────────────────────────────
// Built-in troubleshooter: geometry + composition + quality findings with fixes.
export function diagnoseDesign(args: { design_path: string; project_path?: string; page_id?: string }): ToolResult {
  const op = 'diagnose_design';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  progress.push(pOk('Loaded design', path.basename(dPath)));
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;

  const run = (layers: Layer[], pageId?: string): (Finding & { page?: string })[] =>
    analyzeLayers(layers ?? [], W, H).map(f => (pageId ? { ...f, page: pageId } : f));

  let findings: (Finding & { page?: string })[] = [];
  if (args.page_id && spec.pages) {
    const page = spec.pages.find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, `Pages: ${spec.pages.map(p => p.id).join(', ')}`, progress);
    findings = run(page.layers ?? [], page.id);
  } else if (spec.pages) {
    for (const page of spec.pages) findings.push(...run(page.layers ?? [], page.id));
  } else {
    findings = run(spec.layers ?? []);
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const suggestions = findings.filter(f => f.severity === 'suggestion');
  progress.push(pOk('Diagnosed', `${errors.length} error(s), ${warnings.length} warning(s), ${suggestions.length} suggestion(s)`));
  const summary = errors.length === 0 && warnings.length === 0
    ? (suggestions.length ? 'No problems — some polish suggestions.' : 'Clean — no problems found.')
    : `${errors.length} error(s) + ${warnings.length} warning(s) to fix.`;
  const context = buildContext(op, `Diagnosed "${spec.meta.name}" — ${summary}`);
  return okResult(op, {
    ok: errors.length === 0, summary,
    counts: { errors: errors.length, warnings: warnings.length, suggestions: suggestions.length },
    findings: findings.slice(0, 40), progress, context,
  });
}

// ── render_preview ──────────────────────────────────────────
// Render the design to a PNG and return it INLINE as an image block, so the
// model can actually SEE what it produced (no file written). Closes the
// "MCP is blind" gap — pair with diagnose_design to verify a fix visually.
export function renderPreview(args: { design_path: string; project_path?: string; page_id?: string; scale?: number }): ToolResult {
  const op = 'render_preview';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const componentRegistry = loadComponentRegistry(args.project_path ?? path.dirname(path.dirname(dPath)));
  const scale = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  try {
    const renderSpec = (spec.pages?.length)
      ? ({ ...spec, layers: (args.page_id ? spec.pages.find(p => p.id === args.page_id) : spec.pages[0])?.layers ?? [], pages: undefined } as DesignSpec)
      : spec;
    const svgStr = renderToSVGString(renderSpec, undefined, undefined, componentRegistry);
    const missing = unbundledFonts(svgStr);
    const png = Buffer.from(new Resvg(svgStr, {
      fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(),
    }).render().asPng());
    progress.push(pOk('Rendered preview', `${png.length} bytes @ ${scale}×`));
    const notes = missing.length ? [`Fonts not bundled for raster (fell back; render correctly in the editor): ${missing.join(', ')}`] : [];
    const context = buildContext(op, `Preview of "${spec.meta.name}"`);
    const _attachments = [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }];
    return okResult(op, { status: 'ok', bytes: png.length, scale, ...(notes.length ? { notes } : {}), progress, context, _attachments });
  } catch (err) {
    return errResult(op, `Preview render failed: ${(err as Error).message}`, 'Try export_design format="svg" to verify the design renders.', progress);
  }
}

// ── align_layers ────────────────────────────────────────────
// Auto-align / distribute / snap-to-grid a set of layers (the fix for the
// misalignment findings). Mutates positions in place and writes the YAML.
export function alignLayers(args: { design_path: string; layer_ids: string[]; operation: string; project_path?: string; page_id?: string; grid?: number }): ToolResult {
  const op = 'align_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const arr: Layer[] = (args.page_id && spec.pages) ? (spec.pages.find(p => p.id === args.page_id)?.layers ?? []) : (spec.pages ? spec.pages[0]?.layers ?? [] : spec.layers ?? []);
  const getXY = (l: Layer): { x: number; y: number; w: number; h: number } | null => {
    const p = (l as { pos?: unknown }).pos;
    if (Array.isArray(p) && p.length >= 4 && p.every(n => typeof n === 'number')) return { x: p[0] as number, y: p[1] as number, w: p[2] as number, h: p[3] as number };
    if ([l.x, l.y, l.width, (l as { height?: unknown }).height].every(v => typeof v === 'number')) return { x: l.x as number, y: l.y as number, w: l.width as number, h: (l as { height: number }).height };
    return null;
  };
  const setXY = (l: Layer, x: number, y: number): void => {
    const p = (l as { pos?: number[] }).pos;
    if (Array.isArray(p)) { p[0] = Math.round(x); p[1] = Math.round(y); }
    else { (l as { x: number }).x = Math.round(x); (l as { y: number }).y = Math.round(y); }
  };
  const targets = args.layer_ids.map(id => arr.find(l => l.id === id)).filter((l): l is Layer => !!l);
  const boxed = targets.map(l => ({ l, b: getXY(l) })).filter((t): t is { l: Layer; b: { x: number; y: number; w: number; h: number } } => !!t.b);
  if (boxed.length < 1) return errResult(op, 'No positioned target layers found.', 'Pass layer_ids that exist on the page and have numeric positions.', progress);

  const o = args.operation;
  const grid = typeof args.grid === 'number' && args.grid > 0 ? args.grid : 8;
  const minX = Math.min(...boxed.map(t => t.b.x)), maxR = Math.max(...boxed.map(t => t.b.x + t.b.w));
  const minY = Math.min(...boxed.map(t => t.b.y)), maxB = Math.max(...boxed.map(t => t.b.y + t.b.h));
  for (const { l, b } of boxed) {
    if (o === 'left') setXY(l, minX, b.y);
    else if (o === 'right') setXY(l, maxR - b.w, b.y);
    else if (o === 'top') setXY(l, b.x, minY);
    else if (o === 'bottom') setXY(l, b.x, maxB - b.h);
    else if (o === 'center_h') setXY(l, (minX + maxR) / 2 - b.w / 2, b.y);
    else if (o === 'center_v') setXY(l, b.x, (minY + maxB) / 2 - b.h / 2);
    else if (o === 'snap_grid') setXY(l, Math.round(b.x / grid) * grid, Math.round(b.y / grid) * grid);
  }
  if ((o === 'distribute_h' || o === 'distribute_v') && boxed.length >= 3) {
    const horiz = o === 'distribute_h';
    const sorted = [...boxed].sort((a, c) => horiz ? a.b.x - c.b.x : a.b.y - c.b.y);
    const first = sorted[0].b, last = sorted[sorted.length - 1].b;
    const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
    const totalSize = sorted.reduce((s, t) => s + (horiz ? t.b.w : t.b.h), 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = horiz ? first.x : first.y;
    for (const t of sorted) { if (horiz) { setXY(t.l, cursor, t.b.y); cursor += t.b.w + gap; } else { setXY(t.l, t.b.x, cursor); cursor += t.b.h + gap; } }
  }

  const backup = snapshot(dPath);
  writeYAML(dPath, spec);
  progress.push(pOk(`Aligned ${boxed.length} layer(s)`, o));
  const context = buildContext(op, `Aligned ${boxed.length} layer(s) (${o}) in "${spec.meta.name}"`);
  const link = buildEditorLink(dPath);
  return okResult(op, { status: 'ok', operation: o, aligned: boxed.map(t => t.l.id), backup, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, progress, context, _attachments: [link.attachment] });
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
  layout?: 'paged' | 'scroll' | 'tabs' | 'sidebar' | 'flow';
  nav_type?: 'sidebar' | 'topbar' | 'tabs' | 'dots';
  pages: { id?: string; label: string }[];
  width?: number;
  height?: number;
  data_sources?: { id: string; type: 'inline' | 'json' | 'csv'; path?: string; rows?: Record<string, unknown>[] }[];
  // Flow-report editorial options (used when layout === 'flow'):
  max_width?: number;
  accent?: string;
  font_heading?: string;
  font_body?: string;
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
      // Flow reports are single scrolling documents — no chrome unless explicitly asked.
      navigation: args.nav_type
        ? { type: args.nav_type }
        : args.layout === 'flow' || args.layout === 'scroll'
        ? undefined
        : { type: 'sidebar' },
      data: args.data_sources ? { sources: args.data_sources } : undefined,
      ...(args.layout === 'flow' ? { flow: true } : {}),
      ...(args.max_width != null ? { max_width: args.max_width } : {}),
      ...(args.accent ? { accent: args.accent } : {}),
      ...(args.font_heading ? { font_heading: args.font_heading } : {}),
      ...(args.font_body ? { font_body: args.font_body } : {}),
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
    
    // Resolve datasets: inline/query → baked rows; transform → aggregate its
    // upstream synchronously so group-by charts populate in the export (not just
    // the editor preview).
    const datasets = new Map<string, LoadedDataset>();
    const allSources = spec.report?.data?.sources ?? [];
    for (const src of allSources) {
      if (src.type !== 'transform' && Array.isArray(src.rows)) datasets.set(src.id, { id: src.id, rows: src.rows });
    }
    for (const src of allSources) {
      if (src.type !== 'transform') continue;
      const fromRows = datasets.get(src.from ?? '')?.rows ?? [];
      const rows = src.group_by ? computeGroupAgg(fromRows, src.group_by, (src.agg ?? 'sum') as GroupAggOp, src.value) : (src.rows ?? []);
      datasets.set(src.id, { id: src.id, rows });
    }

    // Cross-reference validation — surfaced as diagnostics, never blocks export.
    const diagnostics = validateReport(spec);
    for (const issue of diagnostics) {
      progress.push(pWarn(`[${issue.code}] ${issue.message}`, issue.fix));
    }

    const html: string = assembleReportHTML(spec, datasets, { theme: args.theme ?? 'dark' });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    progress.push(pOk('Report HTML written', path.basename(outPath)));

    // The deliverable for an interactive report is the RENDERED HTML — serve it
    // directly so the user sees the final result in a browser (the editor canvas
    // is an authoring view, not a faithful preview of the exported output).
    const view = buildReportViewLink(outPath);
    progress.push(pOk('View rendered report', view.view_url));
    // Editor link stays available as a secondary "edit the source" affordance.
    const edit = buildEditorLink(dPath);

    const errors = diagnostics.filter(x => x.severity === 'error').length;
    const summary = diagnostics.length
      ? `Report exported with ${errors} error(s) + ${diagnostics.length - errors} warning(s) — see diagnostics`
      : `Report exported — open ${view.view_url}`;
    const context = buildContext(op, summary, [
      { type: 'html', path: outPath, role: 'report-output' },
    ]);
    const handover = buildHandover('EXPORT', { output_path: outPath, view_url: view.view_url });
    return okResult(op, {
      view_url: view.view_url,
      output_path: outPath,
      output_file: path.basename(outPath),
      bytes: html.length,
      edit_url: edit.open_url,
      diagnostics,
      progress,
      context,
      handover,
      _attachments: [view.attachment, edit.attachment],
    });
  } catch (err) {
    return errResult(op, `HTML assembly failed: ${(err as Error).message}`, 'Ensure design has pages.', progress);
  }
}

// Standalone cross-reference linter for an interactive report — call anytime to
// check charts/tables/filters/buttons/transforms resolve before exporting.
export function validateReportDesign(args: {
  design_path: string;
  project_path?: string;
}): ToolResult {
  const op = 'validate_report';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  if (spec.meta.type !== 'report') return errResult(op, 'Design is not type "report"', 'validate_report only applies to reports.');

  const diagnostics: ReportDiagnostic[] = validateReport(spec);
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const progress: ProgressItem[] = diagnostics.length
    ? diagnostics.map(d => (d.severity === 'error' ? pWarn(`[${d.code}] ${d.message}`, d.fix) : pInfo('warning', `[${d.code}] ${d.message}`)))
    : [pOk('No issues', 'All datasets, fields, and action targets resolve')];
  const context = buildContext(op, diagnostics.length ? `${errors} error(s), ${warnings} warning(s)` : 'Report is valid');
  return okResult(op, { ok: errors === 0, errors, warnings, diagnostics, progress, context });
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

type PathTok =
  | { kind: 'key'; key: string }
  | { kind: 'index'; i: number }
  | { kind: 'filter'; k: string; v: string };

// Tokenize a selector path into keys, array INDICES (`[0]`), and array FILTERS
// (`[id=foo]`). Earlier this only understood `[key=value]`, so `layers[0].x`
// silently resolved to nothing — and patch_design still reported success. Both
// forms are now first-class.
function tokenizePath(dotPath: string): PathTok[] {
  const toks: PathTok[] = [];
  for (const seg of dotPath.split('.')) {
    const m = seg.match(/^([^[\]]*)((?:\[[^\]]+\])*)$/);
    if (!m) return [];
    if (m[1]) toks.push({ kind: 'key', key: m[1] });
    for (const acc of m[2].match(/\[[^\]]+\]/g) ?? []) {
      const inner = acc.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq >= 0) toks.push({ kind: 'filter', k: inner.slice(0, eq), v: inner.slice(eq + 1) });
      else if (/^\d+$/.test(inner)) toks.push({ kind: 'index', i: Number(inner) });
      else toks.push({ kind: 'key', key: inner });
    }
  }
  return toks;
}

function descend(cur: unknown, t: PathTok): unknown {
  if (cur == null || typeof cur !== 'object') return undefined;
  if (t.kind === 'key') return (cur as Record<string, unknown>)[t.key];
  if (t.kind === 'index') return Array.isArray(cur) ? cur[t.i] : undefined;
  return Array.isArray(cur) ? cur.find((it) => it != null && String((it as Record<string, unknown>)[t.k]) === t.v) : undefined;
}

// Returns true iff the value was actually written. A false return means the path
// did not resolve (missing parent, out-of-range index, no filter match) — the
// caller surfaces that instead of pretending the patch landed.
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): boolean {
  const toks = tokenizePath(dotPath);
  if (toks.length === 0) return false;
  let cur: unknown = obj;
  for (let i = 0; i < toks.length - 1; i++) {
    cur = descend(cur, toks[i]);
    if (cur == null || typeof cur !== 'object') return false;
  }
  const last = toks[toks.length - 1];
  if (last.kind === 'key') {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return false;
    (cur as Record<string, unknown>)[last.key] = value;
    return true;
  }
  if (last.kind === 'index') {
    if (!Array.isArray(cur) || last.i < 0 || last.i >= cur.length) return false;
    cur[last.i] = value;
    return true;
  }
  if (!Array.isArray(cur)) return false;
  const idx = cur.findIndex((it) => it != null && String((it as Record<string, unknown>)[last.k]) === last.v);
  if (idx < 0) return false;
  cur[idx] = value;
  return true;
}

// Shorthand-only authoring keys. They drive a PRESET at expansion time, but once
// add_layers has expanded the preset into a concrete group (real x/y/width/height
// + child layers), re-setting them does NOTHING — the renderer reads the children,
// not these. A vision-less model patching `layers[0].pos`/`bg`/`stat` sees
// success but no change, and loops. Detect it and point at the real recovery.
const INERT_ON_EXPANDED = new Set([
  'pos', 'bg', 'bg_style', 'background_style', 'bg_treatment', 'accent', 'text_color',
  'color', 'muted', 'kicker', 'label', 'eyebrow', 'stat', 'value', 'number',
  'subtitle', 'deck', 'caption', 'desc', 'body', 'footer', 'source', 'credit',
  'items', 'blocks', 'rows', 'data', 'series', 'bars', 'steps', 'points', 'metrics',
  'kpis', 'stats', 'values', 'details', 'palette', 'icon', 'mood', 'title',
]);

function inertPresetKeyWarning(spec: Record<string, unknown>, dotPath: string): string | null {
  const toks = tokenizePath(dotPath);
  if (toks.length < 2) return null;
  const last = toks[toks.length - 1];
  if (last.kind !== 'key' || !INERT_ON_EXPANDED.has(last.key)) return null;
  let cur: unknown = spec;
  for (let i = 0; i < toks.length - 1; i++) {
    cur = descend(cur, toks[i]);
    if (cur == null || typeof cur !== 'object') return null;
  }
  const g = cur as Record<string, unknown>;
  const expanded = (g['type'] === 'group' || g['type'] === 'auto_layout')
    && Array.isArray(g['layers']) && (g['layers'] as unknown[]).length > 0
    && typeof g['width'] === 'number' && typeof g['height'] === 'number';
  if (!expanded) return null;
  const gid = typeof g['id'] === 'string' ? g['id'] : '(group)';
  return `"${dotPath}" sets shorthand key "${last.key}" on already-expanded preset "${gid}" — no render effect (it is now concrete child layers). To change its size, position, colour or content: remove_layer "${gid}", then add_layers a fresh preset with the corrected values.`;
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

// ── open_in_editor — return a URL the user can click to open Folio ──
//
// The Anthropic chat UI renders text content as Markdown, so a plain URL
// becomes a clickable link. We also attach a `resource` block so MCP
// clients that support resource previews can render the link richly.
export function openInEditor(args: {
  design_path?: string;
  project_path?: string;
  editor_url?: string;
  page?: number;
}): ToolResult {
  const op = 'open_in_editor';
  const progress: ProgressItem[] = [];

  let dPath = '';
  if (args.design_path) {
    dPath = resolveDesignPath(args.design_path, args.project_path);
    if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  }

  const link = buildEditorLink(dPath || undefined, {
    ...(typeof args.page === 'number' ? { page: args.page } : {}),
    ...(args.editor_url ? { editorUrl: args.editor_url } : {}),
  });
  progress.push(pOk('Editor URL', link.open_url));

  const context = buildContext(op, `Editor link generated`,
    dPath ? [{ type: 'design', path: dPath, role: 'opened' }] : []);
  const handover = buildHandover('EXPORT', dPath ? { design_path: dPath } : {});

  return okResult(op, {
    url: link.open_url,
    editor_url: link.editor_url,
    design_path: dPath || undefined,
    hint: `Open ${link.open_url} in a browser. The editor will live-refresh as MCP edits the file.`,
    progress,
    context,
    handover,
    _attachments: [link.attachment],
  });
}
