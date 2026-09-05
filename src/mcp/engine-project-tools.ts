// Folio MCP engine — project/design/task CRUD + inspect tools. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page, ThemeSpec } from '../schema/types';
import type { ToolResult } from './types';
import { ALL_THEMES } from '../themes/all-themes';

import type { ProgressItem } from './types';

import { resolveDesignPath, resolveProjectPath, snapshot, readYAML, writeYAML, generateId, errResult, okResult, LIMITS, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';
import { buildGuide } from './engine/guide';

import { buildEditorLink } from './engine/editor-link';
import { bareNameSegment } from './normalize-paths';

import { createTaskFile, readTask, buildNextAction } from './engine/task';
import type { NextAction } from './types';

import { isConstrained } from './engine-runtime-tools';
import { SPEC_FIELD } from './design-spec';

/** Delete abandoned EMPTY in-progress drafts in a project's designs/ dir. A model
 *  that calls create_design, never fills it, then creates another leaves an orphan
 *  0-layer stub that renders blank and clutters the project (suite-021/034/053/
 *  056/058/084 each shipped a ~280-byte empty draft beside the real design). Only
 *  touches drafts that are `in_progress` with NO layers AND NO pages — never a
 *  sealed design or one with any content. Returns the basenames pruned. */
export function pruneEmptyDrafts(projectPath: string, keepPath: string): string[] {
  const dir = path.join(projectPath, 'designs');
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const keep = path.resolve(keepPath);
  const pruned: string[] = [];
  for (const f of files) {
    if (!f.endsWith('.design.yaml')) continue;
    const fp = path.join(dir, f);
    if (path.resolve(fp) === keep) continue;
    let spec: { _mode?: string; layers?: unknown[]; pages?: unknown[] };
    try { spec = readYAML(fp); } catch { continue; }
    const emptyLayers = !Array.isArray(spec.layers) || spec.layers.length === 0;
    const emptyPages = !Array.isArray(spec.pages) || spec.pages.length === 0;
    if (spec._mode === 'in_progress' && emptyLayers && emptyPages) {
      try { fs.unlinkSync(fp); pruned.push(f); } catch { /* best-effort */ }
    }
  }
  return pruned;
}

export function createDesign(args: { project_path: string; name: string; type?: string; width?: number; height?: number; theme_ref?: string; style_seed?: string | number }): ToolResult {
  const op = 'create_design';
  const progress: ProgressItem[] = [];
  // Guard the required args with actionable messages — a small model that omits
  // project_path (or passes it as `path`) would otherwise hit a raw
  // path.join(undefined) crash and tend to hallucinate a fake result.
  if (!args.project_path) return errResult(op, 'create_design needs project_path', 'Pass project_path = the project name (e.g. "ai-poster"). Run create_project first, then reuse the path it returns.', progress);
  if (!args.name) return errResult(op, 'create_design needs a name', 'Pass name = the design name (e.g. "hero").', progress);
  const type = args.type ?? 'poster';
  const designId = args.name.toLowerCase().replace(/\s+/g, '-');
  // Resolve the project the same way create_project does. Joining the raw arg
  // meant a BARE name — the form the tool description asks for — was resolved
  // against the process CWD instead of the projects dir, so the design was
  // created somewhere nobody was looking and no error was raised. It was
  // masked over HTTP, where normalizeProjectPaths resolves the arg first; every
  // other caller silently wrote outside the library.
  let projectDir: string;
  try {
    projectDir = resolveProjectPath(args.project_path);
  } catch (e) {
    return errResult(op, (e as Error).message, `Pass a bare project name (e.g. "${args.project_path}") — the engine places it in the projects dir. Don't build absolute /home/... paths.`, progress);
  }
  const designPath = path.join(projectDir, `designs/${designId}.design.yaml`);
  const today = new Date().toISOString().split('T')[0];

  // Physical dimensions (mm / inches) mistaken for px — a "90×38" wine label
  // renders as a 90×38px postage stamp (suite-026). When BOTH sides are far below
  // any real screen canvas, scale up preserving aspect so the long side ≈ 1080px.
  // Gated at <200 so genuine small web sizes (300×250 ad, 160×600 skyscraper) are
  // left alone.
  let w = args.width ?? 1080, h = args.height ?? 1080;
  if (w > 0 && h > 0 && Math.max(w, h) < 200) {
    const k = 1080 / Math.max(w, h);
    const nw = Math.round(w * k), nh = Math.round(h * k);
    progress.push(pInfo('Scaled up a sub-pixel canvas', `${w}×${h} → ${nw}×${nh} (physical dims read as px)`));
    w = nw; h = nh;
  }

  const spec: DesignSpec = {
    _protocol: 'design/v1',
    // A freshly-created design is EMPTY — it is a draft until add_layers + seal,
    // not 'complete'. The old poster default of 'complete' made an abandoned,
    // never-filled poster masquerade as a finished design (suite-025/056/066
    // empties shipped looking sealed). seal_design sets 'complete'.
    _mode: 'in_progress',
    meta: {
      id: generateId(), name: args.name, type: type as 'poster' | 'carousel',
      created: today, modified: today, generator: 'mcp',
      generation: type === 'carousel' ? { status: 'in_progress', total_pages: 0, completed_pages: 0 } : undefined,
      // Kept on the design, not just in the call that made it: a seed asks for
      // a departure, and the only way to tell whether one was taken is to
      // compare designs made under different seeds later (see design-history).
      ...(args.style_seed !== undefined && args.style_seed !== '' ? { style_seed: String(args.style_seed) } : {}),
    },
    document: { width: w, height: h, unit: 'px', dpi: 96 },
    theme: { ref: args.theme_ref ?? 'editorial-cream' },
    ...(type === 'carousel' ? { pages: [] } : { layers: [] }),
  };

  writeYAML(designPath, spec);
  progress.push(pOk(`Created ${type} scaffold`, path.basename(designPath)));

  // Self-contained editor link (fresh token) — design is openable immediately.
  const link = buildEditorLink(designPath);
  progress.push(pOk('Editor link', link.short_url ?? link.open_url));

  const projectPath = path.join(projectDir, 'project.yaml');
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
    // Design number two is where convergence starts, and the model cannot see
    // the ones already here. Said at the moment it is about to compose, from a
    // count that was being read anyway — no scan, no cost.
    if (project.designs.length >= 2) {
      progress.push(pInfo(`This project already holds ${project.designs.length} design(s)`, 'manage_design {op:"style_history"} reports what they already look like — structure, composition, palette, type scale — and which of those has stopped varying. Worth a call before composing, or number five repeats number one.'));
    }
    project.designs.push({ id: designId, path: `designs/${designId}.design.yaml`, type, status: 'draft' });
    writeYAML(projectPath, project);
    progress.push(pOk('Registered in project.yaml'));
    const context = buildContext(op, `Created ${type} design "${args.name}"`, [
      { type: 'design', path: designPath, role: 'created' },
    ]);
    const handover = buildHandover('DESIGN', { design_path: designPath, project_path: projectDir }, { type: type as 'poster' | 'carousel' });
    return okResult(op, { design_id: spec.meta.id, path: designPath, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, next_action, progress, context, handover, _attachments: [link.attachment] }, bak);
  }
  const context = buildContext(op, `Created ${type} design "${args.name}"`, [
    { type: 'design', path: designPath, role: 'created' },
  ]);
  const handover = buildHandover('DESIGN', { design_path: designPath, project_path: projectDir }, { type: type as 'poster' | 'carousel' });
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
        // Anti-loop nudge: a model that can't SEE its output tends to spin up a
        // new project per "make it better" instead of looking. This project
        // already exists — to improve a design, render_preview to SEE it, then
        // patch_design / update_layer to edit it in place. Don't keep creating
        // near-duplicate projects (list_designs shows what's already here).
        hint: 'This project already exists — do NOT create more projects to "improve" a design. Call render_preview to SEE the current design, then edit it in place with patch_design or edit_layer {op:"update"}. Recreating from scratch loses your work and rarely fixes anything you can\'t see.',
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
  const themeId = args.theme && ALL_THEMES[args.theme] ? args.theme : 'editorial-cream';
  const theme = ALL_THEMES[themeId];
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
  const available_builtins = Object.keys(ALL_THEMES).filter(id => !seededIds.has(id));
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
  if (!themeEntry && ALL_THEMES[args.theme_id]) {
    const themeDir = path.join(args.project_path, 'themes');
    fs.mkdirSync(themeDir, { recursive: true });
    const relPath = `themes/${args.theme_id}.theme.yaml`;
    const absPath = path.join(args.project_path, relPath);
    writeYAML(absPath, ALL_THEMES[args.theme_id]);
    themeEntry = { id: args.theme_id, path: relPath, active: false };
    themes.push(themeEntry);
    project.themes = themes;
    progress.push(pOk(`Seeded builtin theme "${args.theme_id}"`, relPath));
  }

  if (!themeEntry) {
    const available = [...themes.map(t => t.id), ...Object.keys(ALL_THEMES)];
    return errResult(op, `Theme not found: ${args.theme_id}`, `Available: ${available.join(', ')}`, progress);
  }

  const bak = snapshot(projectPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  for (const t of themes) t.active = t.id === args.theme_id;
  project.config.default_theme = args.theme_id;
  writeYAML(projectPath, project);
  progress.push(pOk(`Active theme set to "${args.theme_id}"`, `${(project.designs ?? []).length} design(s) affected`));

  // Surface the theme's BRAND CHARACTER (theme/v1.1) so the model inherits the
  // voice — atmosphere + an authored type ladder + section rhythm — not just the
  // color tokens. Resolve from the builtin or the seeded theme YAML.
  const spec = ALL_THEMES[args.theme_id]
    ?? (themeEntry.path && fs.existsSync(path.join(args.project_path, themeEntry.path))
      ? readYAML<ThemeSpec>(path.join(args.project_path, themeEntry.path)) : undefined);
  const brand = spec && (spec.atmosphere || spec.type_ladder || spec.section_rhythm)
    ? {
      ...(spec.atmosphere ? { atmosphere: spec.atmosphere } : {}),
      ...(spec.type_ladder ? { type_ladder: spec.type_ladder } : {}),
      ...(spec.section_rhythm ? { section_rhythm: spec.section_rhythm } : {}),
    }
    : undefined;
  if (brand?.atmosphere) progress.push(pInfo('Brand voice', `${brand.atmosphere} — design to this, not just the palette.`));

  const context = buildContext(op, `Applied theme "${args.theme_id}" to project`, [
    { type: 'project', path: projectPath, role: 'updated' },
  ]);
  const handover = buildHandover('PROJECT', { project_path: args.project_path });
  return okResult(op, { active_theme: args.theme_id, affected_designs: (project.designs ?? []).length, ...(brand ? { brand } : {}), progress, context, handover }, bak);
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

  // Recurse into groups — LOCKED groups included (their children were
  // invisible here before, which dead-ended edit_layer on any child id).
  // Children carry `parent` and inherit `locked` so the model knows why an
  // update may refuse and what to unlock.
  const summarise = (layers: Layer[] = []) => {
    type Row = { id: string; type: string; z?: number; x: number; y: number; w: unknown; h: unknown; parent?: string; locked?: boolean; spec?: string };
    const rows: Row[] = [];
    const walk = (ls: Layer[], parent?: string, parentLocked?: boolean): void => {
      for (const l of ls) {
        const locked = Boolean((l as { locked?: unknown }).locked) || Boolean(parentLocked);
        // A group built from a preset carries the spec that made it, so say so
        // here: thirty generated child rows are the WRONG thing to edit when
        // one patch_spec call would change the intent that produced them.
        const authored = (l as unknown as Record<string, unknown>)[SPEC_FIELD];
        const specType = authored && typeof authored === 'object'
          ? String((authored as Record<string, unknown>)['type'] ?? 'preset') : undefined;
        rows.push({
          id: l.id, type: l.type, z: l.z, x: l.x ?? 0, y: l.y ?? 0,
          w: l.width ?? 0, h: (l as unknown as Record<string, unknown>)['height'] ?? 0,
          ...(parent ? { parent } : {}), ...(locked ? { locked: true } : {}),
          ...(specType ? { spec: specType } : {}),
        });
        const children = (l as Layer & { layers?: Layer[] }).layers;
        if (l.type === 'group' && Array.isArray(children)) walk(children, l.id, locked);
      }
    };
    walk(layers);
    if (constrained && rows.length > limit) {
      progress.push(pWarn('Constrained mode: returning metadata only', `${rows.length} layers total`));
      return [];
    }
    return rows.slice(0, limit);
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
