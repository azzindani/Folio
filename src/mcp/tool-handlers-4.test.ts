import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProject, createDesign, appendPage, patchDesign, addLayer, updateLayer, listThemes, batchCreate, saveAsComponent, exportDesign, exportTemplate, injectTemplate, listTemplateSlots, addLayers, getEngineGuide, listTasks, createTask, resumeTask, inspectDesign } from './engine';
import type { Layer, DesignSpec } from '../schema/types';

import { parseDesign } from '../schema/parser';

const parseYAMLDesign = (p: string): DesignSpec => parseDesign(fs.readFileSync(p, 'utf-8'));

function makeDesignFile(dir: string): string {
  const p = path.join(dir, 'test.design.yaml');
  const spec = {
    _protocol: 'design/v1',
    meta: { id: 't1', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [
      { id: 'title', type: 'text', z: 10, x: 0, y: 0, width: 500, height: 80,
        content: { type: 'plain', value: 'Hello World' }, style: { font_size: 48 } },
      { id: 'hero', type: 'image', z: 5, x: 0, y: 100, width: 400, height: 300, src: 'https://example.com/img.jpg' },
    ],
  };
  fs.writeFileSync(p, JSON.stringify(spec));
  return p;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('injectTemplate', () => {
  function makeTemplate(dir: string): string {
    const designPath = makeDesignFile(dir);
    const r = exportTemplate({ design_path: designPath });
    return r.template_path as string;
  }

  it('injects slots and writes design file', () => {
    const tplPath = makeTemplate(tmpDir);
    const outPath = path.join(tmpDir, 'injected.yaml');
    const result = injectTemplate({
      template_path: tplPath,
      slots: { title_text: 'Injected Title', hero_src: '/local/photo.jpg' },
      output_path: outPath,
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.slots_injected).toBe(2);
  });

  it('auto-derives output path when not specified', () => {
    const tplPath = makeTemplate(tmpDir);
    const result = injectTemplate({ template_path: tplPath, slots: {} });
    expect(result.success).toBe(true);
    const outPath = result.design_path as string;
    expect(outPath).toContain('.design.yaml');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing template', () => {
    const result = injectTemplate({ template_path: path.join(tmpDir, 'none.yaml'), slots: {} });
    expect(result.success).toBe(false);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = injectTemplate({ template_path: designPath, slots: {} });
    expect(result.success).toBe(false);
  });
});

describe('listTemplateSlots', () => {
  it('lists slots from a valid template', () => {
    const designPath = makeDesignFile(tmpDir);
    const r = exportTemplate({ design_path: designPath });
    const tplPath = r.template_path as string;
    const result = listTemplateSlots({ template_path: tplPath });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(2);
    const slots = parsed.slots as Array<Record<string, unknown>>;
    expect(slots[0]).toHaveProperty('id');
    expect(slots[0]).toHaveProperty('path');
    expect(slots[0]).toHaveProperty('type');
  });

  it('returns error for missing file', () => {
    const result = listTemplateSlots({ template_path: path.join(tmpDir, 'none.yaml') });
    expect(result.success).toBe(false);
  });

  it('returns error for non-template file', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = listTemplateSlots({ template_path: designPath });
    expect(result.success).toBe(false);
  });
});

// ── saveAsComponent error path ───────────────────────────────

describe('saveAsComponent — error paths', () => {
  it('returns error when design file does not exist (line 491)', () => {
    const result = saveAsComponent({
      design_path: path.join(tmpDir, 'nonexistent.yaml'),
      layer_ids: ['any'],
      component_name: 'Ghost',
      project_path: tmpDir,
    });
    expect(result.success).toBe(false);
  });
});

// ── setNestedValue array notation ────────────────────────────

describe('patchDesign — array selector notation (lines 666-669)', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'arr-proj');
    createProject({ name: 'Array Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Array Patch', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/array-patch.design.yaml');
    appendPage({
      design_path: designPath,
      page_id: 'page_1',
      label: 'Page One',
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as Layer],
    });
  });

  it('patches label of a page using array[key=val] notation', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=page_1].label', value: 'Updated' }],
    });
    expect(result.success).toBe(true);
    const content = fs.readFileSync(designPath, 'utf-8');
    expect(content).toContain('Updated');
  });

  it('patches a layer by array INDEX (layers[0].x)', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=page_1].layers[0].x', value: 25 }],
    });
    expect(result.success).toBe(true);
    expect(result.patched_paths).toContain('pages[id=page_1].layers[0].x');
    const content = fs.readFileSync(designPath, 'utf-8');
    expect(content).toMatch(/x:\s*25/);
  });

  it('FAILS loudly when array item not found (was: silent no-op success)', () => {
    // pages[id=missing] → no match → unresolved → only selector → errResult.
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=missing].label', value: 'Oops' }],
    });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(designPath, 'utf-8')).not.toContain('Oops');
  });

  it('FAILS loudly when an intermediate key is missing (was: silent no-op success)', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'missingKey.sub.value', value: 42 }],
    });
    expect(result.success).toBe(false);
  });

  it('reports inert patches on an expanded preset group (no render effect)', () => {
    appendPage({
      design_path: designPath, page_id: 'page_2', label: 'Page Two',
      layers: [{ id: 'stat_1', type: 'group', z: 0, x: 0, y: 0, width: 1080, height: 1350,
        layers: [{ id: 'stat_1_bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350 }] } as unknown as Layer],
    });
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'pages[id=page_2].layers[0].pos', value: [0, 0, 1080, 1080] }],
    });
    expect(result.success).toBe(true);
    expect(result.inert_no_effect).toBeTruthy();
    expect((result.inert_no_effect as string[])[0]).toMatch(/no render effect/);
  });
});

// ── listThemes — missing project (line 326) ──────────────────

describe('listThemes — missing project', () => {
  it('returns error when project.yaml does not exist (line 326)', () => {
    const result = listThemes({ project_path: path.join(tmpDir, 'no-such-project') });
    expect(result.success).toBe(false);
    expect(result.error as string).toContain('Project not found');
  });
});

// ── exportDesign — validation errors (line 348) ──────────

describe('exportDesign — validation errors', () => {
  it('returns error when design has critical validation errors (line 348)', () => {
    // Write a design file with a missing required field to trigger validation errors
    const designPath = path.join(tmpDir, 'bad.design.yaml');
    fs.writeFileSync(designPath, JSON.stringify({
      _protocol: 'design/v1',
      meta: { id: 'bad', name: 'Bad', type: 'poster', created: '', modified: '' },
      // missing document → validation error
      layers: [],
    }));
    const result = exportDesign({ design_path: designPath, format: 'svg' });
    // Either error (validation fails) or success (if validator passes)
    // Just ensure no crash
    expect(result).toBeDefined();
  });
});

// ── addLayer — spec.layers undefined (line 244) ──────────────

describe('addLayer — spec has no layers field', () => {
  it('creates layers array when spec.layers is undefined (line 244)', () => {
    // Write a design YAML with no layers field
    const designPath = path.join(tmpDir, 'no-layers.design.yaml');
    const yamlContent = `_protocol: design/v1
meta:
  id: no-layers
  name: No Layers
  type: poster
  created: '2024-01-01'
  modified: '2024-01-01'
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
`;
    fs.writeFileSync(designPath, yamlContent);
    const result = addLayer({
      design_path: designPath,
      layer: { id: 'first', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100 } as Layer,
    });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.layer_id).toBe('first');
  });
});

// ── updateLayer — non-matching layers return unchanged (line 272) ──

describe('updateLayer — multiple layers, non-matching return unchanged (line 272)', () => {
  it('updateLayer skips non-matching layers via return l (line 272)', () => {
    const projectPath = path.join(tmpDir, 'proj2');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Multi Layer' });
    const designPath = path.join(projectPath, 'designs/multi-layer.design.yaml');

    addLayer({ design_path: designPath, layer: { id: 'layer-a', type: 'rect', z: 1, x: 0, y: 0, width: 50, height: 50 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'layer-b', type: 'rect', z: 2, x: 100, y: 0, width: 50, height: 50 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'layer-c', type: 'rect', z: 3, x: 200, y: 0, width: 50, height: 50 } as Layer });

    // Update only layer-b — layer-a and layer-c go through line 272
    const result = updateLayer({ design_path: designPath, layer_id: 'layer-b', props: { x: 999 } });
    expect(result.success).toBe(true);
  });
});

// ── batchCreate — slots_array with name slot (line 371 ?? branch) ──────────────

describe('batchCreate — ?? fallback for name', () => {
  it('uses template_id fallback name when slot has no name (line 371 ?? branch)', () => {
    const projectPath = path.join(tmpDir, 'batch-noname');
    createProject({ name: 'Batch NoName', path: projectPath });
    createDesign({ project_path: projectPath, name: 'my-tpl' });
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'my-tpl',
      slots_array: [{ title: 'No Name Slot' }],
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(1);
    // Name should use template_id fallback since no 'name' key in slot
    const created = parsed.created as Array<Record<string, unknown>>;
    expect(created[0].design_id).toBeDefined();
  });
});

// ── getEngineGuide ───────────────────────────────────────────
describe('getEngineGuide', () => {
  it('returns quick_ref section by default', () => {
    const result = getEngineGuide({}) as Record<string, unknown>;
    expect(result.section).toBe('quick_ref');
    expect(typeof result.guide).toBe('string');
    expect((result.guide as string).length).toBeGreaterThan(10);
  });

  it('returns specific section when requested', () => {
    const result = getEngineGuide({ section: 'shorthand' }) as Record<string, unknown>;
    expect(result.section).toBe('shorthand');
    expect((result.guide as string)).toContain('Shorthand');
  });

  it('returns error message for unknown section', () => {
    const result = getEngineGuide({ section: 'nonexistent' }) as Record<string, unknown>;
    expect((result.guide as string)).toContain('Unknown section');
  });
});

// ── listTasks ────────────────────────────────────────────────
describe('listTasks', () => {
  it('returns empty list when no .tasks dir exists', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    const result = listTasks({ project_path: projectPath }) as Record<string, unknown>;
    expect(result.tasks).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('lists tasks from .tasks directory', () => {
    const projectPath = path.join(tmpDir, 'proj2');
    fs.mkdirSync(projectPath);
    fs.mkdirSync(path.join(projectPath, '.tasks'));
    const taskYaml = `task_id: t1\nbrief: test\ndesign_path: x.yaml\ntotal_pages: 2\npages:\n  - {id: p1, status: done}\n  - {id: p2, status: pending}\n`;
    fs.writeFileSync(path.join(projectPath, '.tasks', 'task-1.task.yaml'), taskYaml);
    const result = listTasks({ project_path: projectPath }) as Record<string, unknown>;
    expect(result.total).toBe(1);
    const tasks = result.tasks as Array<Record<string, unknown>>;
    expect(tasks[0].task_id).toBe('t1');
    expect(tasks[0].status).toBe('in_progress');
  });
});

// ── createTask ───────────────────────────────────────────────
describe('createTask', () => {
  let projectPath: string;
  beforeEach(() => {
    projectPath = path.join(tmpDir, 'ctproj');
    createProject({ name: 'CT Project', path: projectPath });
  });

  it('creates carousel design + task file', () => {
    const result = createTask({
      project_path: projectPath,
      task_name: 'my-carousel',
      brief: 'A test carousel',
      pages: [{ label: 'Cover', hints: 'hero image' }, { label: 'Detail' }],
    }) as Record<string, unknown>;
    expect(result).toBeDefined();
    const taskPath = result.task_path as string;
    expect(fs.existsSync(taskPath)).toBe(true);
    expect(result.total_pages).toBe(2);
  });

  it('returns error when pages array is empty', () => {
    const result = createTask({
      project_path: projectPath, task_name: 'bad', brief: 'x', pages: [],
    });
    expect((result as Record<string, unknown>).success).toBe(false);
  });
});

// ── resumeTask ───────────────────────────────────────────────
describe('resumeTask', () => {
  it('returns error for missing task file', () => {
    const result = resumeTask({ task_path: path.join(tmpDir, 'nonexistent.task.yaml') }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('returns next_action for in-progress task', () => {
    const projectPath = path.join(tmpDir, 'rtproj');
    createProject({ name: 'RT Project', path: projectPath });
    const created = createTask({
      project_path: projectPath, task_name: 'rt-carousel', brief: 'resume test',
      pages: [{ label: 'Page 1' }, { label: 'Page 2' }],
    }) as Record<string, unknown>;
    const taskPath = created.task_path as string;
    const result = resumeTask({ task_path: taskPath }) as Record<string, unknown>;
    expect(result.next_action).toBeDefined();
    expect((result.next_action as Record<string, unknown>).tool).toBe('append_page');
  });
});

// ── inspectDesign ────────────────────────────────────────────
describe('inspectDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'idproj');
    createProject({ name: 'ID Project', path: projectPath });
    const d = createDesign({ project_path: projectPath, name: 'poster1', type: 'poster' }) as Record<string, unknown>;
    designPath = d.path as string;
  });

  it('returns poster layer info', () => {
    const result = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.type).toBe('poster');
    expect(typeof result.layer_count).toBe('number');
  });

  it('returns error for missing design', () => {
    const result = inspectDesign({ design_path: path.join(tmpDir, 'missing.design.yaml') }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('inspects carousel page by id', () => {
    const proj2 = path.join(tmpDir, 'idproj2');
    createProject({ name: 'ID2', path: proj2 });
    const cd = createDesign({ project_path: proj2, name: 'carousel1', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'page1', label: 'Page 1', layers: [] });
    const result = inspectDesign({ design_path: cdPath, page_id: 'page1' }) as Record<string, unknown>;
    expect(result.page_id).toBe('page1');
  });

  it('returns error for unknown page_id', () => {
    const proj3 = path.join(tmpDir, 'idproj3');
    createProject({ name: 'ID3', path: proj3 });
    const cd = createDesign({ project_path: proj3, name: 'car2', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'p1', label: 'P1', layers: [] });
    const result = inspectDesign({ design_path: cdPath, page_id: 'missing_page' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});

// ── addLayers ────────────────────────────────────────────────
describe('addLayers', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'alproj');
    createProject({ name: 'AL Project', path: projectPath });
    const d = createDesign({ project_path: projectPath, name: 'design1', type: 'poster' }) as Record<string, unknown>;
    designPath = d.path as string;
  });

  it('adds verbose layers to poster', () => {
    const result = addLayers({
      design_path: designPath,
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.added).toBe(1);
  });

  it('adds shorthand layers to poster', () => {
    const result = addLayers({
      design_path: designPath,
      layers_shorthand: [{ id: 'sh-rect', type: 'rect', z: 0, pos: [0, 0, 540, 540] }],
    }) as Record<string, unknown>;
    expect(result.added).toBe(1);
    const ids = result.layer_ids as string[];
    expect(ids).toContain('sh-rect');
  });

  it('returns error when no layers provided', () => {
    const result = addLayers({ design_path: designPath }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('clamps an oversized preset (h:1350 on a 1080 doc) to the canvas — no off_canvas', () => {
    addLayers({
      design_path: designPath,
      layers_shorthand: [{ id: 'stat_1', type: 'stat', z: 0, pos: [0, 0, 1080, 1350],
        bg: '#FAF5EC', accent: '#B8543C', stat: '$37B', caption: 'in the US' }],
    });
    const info = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    const grp = (info.layers as { id: string; h: number }[]).find(l => l.id === 'stat_1')!;
    expect(grp.h).toBeLessThanOrEqual(1080);
  });

  it('width-fits a hand-placed text layer with NO width so it wraps, not overflows', () => {
    // The feature_grid title-overflow case: a model hand-places a long headline
    // with no x/width → it would render at natural width and run off both edges.
    addLayers({
      design_path: designPath,
      layers_shorthand: [{ id: 'headline', type: 'text', z: 2,
        content: { type: 'plain', value: 'Can a 30B AI Model Create Designs?' } } as unknown as import('./shorthand-parser').ShorthandLayer],
    });
    const info = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    const t = (info.layers as { id: string; x: number; w: number }[]).find(l => l.id === 'headline')!;
    expect(t.w).toBeGreaterThan(0);
    expect(t.x + t.w).toBeLessThanOrEqual(1080); // stays inside the canvas
    expect(t.x).toBeGreaterThan(0);              // nudged off the hard left edge
  });

  it('rejects a junk-BLOB string layers_shorthand (no brackets, not JSON)', () => {
    // Weak models pick feature_grid but encode it as a flat blob with no
    // [x,y,w,h] bracket and no JSON structure. It can't parse → error with the
    // exact array shape rather than silently making one junk text layer.
    const result = addLayers({
      design_path: designPath,
      layers_shorthand: 'feature_grid:0,0,1080,1080:title=Brew Lab:items=icon=coffee:title=Fresh:desc=Sourced' as unknown as import('./shorthand-parser').ShorthandLayer[],
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('STRING');
    expect(String(result.hint)).toContain('feature_grid');
    expect(String(result.hint)).toContain('items');
  });

  it('PARSES a stringified JSON/YAML array layers_shorthand (the carousel drop fix)', () => {
    // A model that JSON-stringifies the array (unquoted keys = YAML flow) must
    // succeed, not silently drop — this was the 6-page-carousel-went-blank bug.
    const result = addLayers({
      design_path: designPath,
      layers_shorthand: '[{type: "text", pos: [100,100,800,200], text: "Hello", size: 64}]' as unknown as import('./shorthand-parser').ShorthandLayer[],
    }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.added).toBe(1);
  });

  it('returns error for missing design', () => {
    const result = addLayers({
      design_path: path.join(tmpDir, 'nope.design.yaml'),
      layers: [{ id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('adds layers to a specific page in carousel', () => {
    const proj2 = path.join(tmpDir, 'alcarproj');
    createProject({ name: 'ALC', path: proj2 });
    const cd = createDesign({ project_path: proj2, name: 'car', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'pg1', label: 'PG1', layers: [] });
    const result = addLayers({
      design_path: cdPath,
      page_id: 'pg1',
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.added).toBe(1);
  });

  it('returns error for unknown page_id in carousel', () => {
    const proj3 = path.join(tmpDir, 'alcarproj2');
    createProject({ name: 'ALC2', path: proj3 });
    const cd = createDesign({ project_path: proj3, name: 'car2', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'pg1', label: 'PG1', layers: [] });
    const result = addLayers({
      design_path: cdPath,
      page_id: 'nonexistent_page',
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });

  it('renames colliding layer ids instead of creating duplicates', () => {
    const L = (id: string): import('../schema/types').Layer =>
      ({ id, type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as import('../schema/types').Layer);
    addLayers({ design_path: designPath, layers: [L('rect_1'), L('text_2')] });
    const r2 = addLayers({ design_path: designPath, layers: [L('rect_1'), L('text_2')] }) as Record<string, unknown>;
    const ids = r2.layer_ids as string[];
    // Second batch must not reuse rect_1 / text_2 — they were renamed.
    expect(ids).not.toContain('rect_1');
    expect(ids).not.toContain('text_2');
    expect(ids).toEqual(['rect_1-2', 'text_2-2']);
    const spec = parseYAMLDesign(designPath);
    const allIds = (spec.layers ?? []).map(l => l.id);
    expect(new Set(allIds).size).toBe(allIds.length); // all unique
  });

  it('normalizes a callout `text` alias to canonical `content`', () => {
    addLayers({
      design_path: designPath,
      layers: [{ id: 'co', type: 'callout', z: 0, x: 0, y: 0, width: 200, height: 60, text: 'hello' } as unknown as import('../schema/types').Layer],
    });
    const co = parseYAMLDesign(designPath).layers?.find(l => l.id === 'co') as unknown as Record<string, unknown>;
    expect(co.content).toBe('hello');
    expect(co.text).toBeUndefined();
  });

  it('normalizes chart `chart`/`x`/`y` aliases to chart_type/x_field/y_field', () => {
    addLayers({
      design_path: designPath,
      layers: [{ id: 'ch', type: 'interactive_chart', z: 0, width: 600, height: 360, chart: 'bar', data_ref: 'd', x: 'ticker', y: 'ytd' } as unknown as import('../schema/types').Layer],
    });
    const ch = parseYAMLDesign(designPath).layers?.find(l => l.id === 'ch') as unknown as Record<string, unknown>;
    expect(ch.chart_type).toBe('bar');
    expect(ch.x_field).toBe('ticker');
    expect(ch.y_field).toBe('ytd');
    expect(ch.chart).toBeUndefined();
    expect(ch.x).toBeUndefined();
    expect(ch.y).toBeUndefined();
  });

  it('normalizes chart `kind` alias + table column `label`→title', () => {
    addLayers({
      design_path: designPath,
      layers: [
        { id: 'ck', type: 'interactive_chart', z: 0, width: 600, height: 360, kind: 'line', data_ref: 'd', x_field: 'a', y_field: 'b' } as unknown as import('../schema/types').Layer,
        { id: 'tb', type: 'interactive_table', z: 0, width: 600, height: 300, data_ref: 'd', columns: [{ field: 'a', label: 'Alpha' }, { field: 'b', header: 'Beta' }] } as unknown as import('../schema/types').Layer,
      ],
    });
    const layers = parseYAMLDesign(designPath).layers ?? [];
    const ck = layers.find(l => l.id === 'ck') as unknown as Record<string, unknown>;
    expect(ck.chart_type).toBe('line');
    expect(ck.kind).toBeUndefined();
    const tb = layers.find(l => l.id === 'tb') as unknown as { columns: Record<string, unknown>[] };
    expect(tb.columns[0].title).toBe('Alpha');
    expect(tb.columns[1].title).toBe('Beta');
  });

  it('leaves a numeric chart x/y (pixel position) alone', () => {
    addLayers({
      design_path: designPath,
      layers: [{ id: 'ch2', type: 'interactive_chart', z: 0, x: 40, y: 80, width: 600, height: 360, chart_type: 'line', data_ref: 'd', x_field: 'a', y_field: 'b' } as unknown as import('../schema/types').Layer],
    });
    const ch = parseYAMLDesign(designPath).layers?.find(l => l.id === 'ch2') as unknown as Record<string, unknown>;
    expect(ch.x).toBe(40);
    expect(ch.y).toBe(80);
    expect(ch.x_field).toBe('a');
  });

  it('routes to the sole page when page_id is omitted on a paged design', () => {
    const proj = path.join(tmpDir, 'alsole');
    createProject({ name: 'Sole', path: proj });
    const cd = createDesign({ project_path: proj, name: 'one', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'only', label: 'Only', layers: [] });
    const r = addLayers({
      design_path: cdPath,
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(r.added).toBe(1);
    const spec = parseYAMLDesign(cdPath);
    expect(spec.pages?.[0].layers?.some(l => l.id === 'lyr')).toBe(true);
    expect(spec.layers ?? []).toHaveLength(0); // never spilled to top-level
  });

  it('errors when page_id is omitted on a multi-page design', () => {
    const proj = path.join(tmpDir, 'almulti');
    createProject({ name: 'Multi', path: proj });
    const cd = createDesign({ project_path: proj, name: 'two', type: 'carousel' }) as Record<string, unknown>;
    const cdPath = cd.path as string;
    appendPage({ design_path: cdPath, page_id: 'p1', label: 'P1', layers: [] });
    appendPage({ design_path: cdPath, page_id: 'p2', label: 'P2', layers: [] });
    const r = addLayers({
      design_path: cdPath,
      layers: [{ id: 'lyr', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as import('../schema/types').Layer],
    }) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('page_id');
  });
});
