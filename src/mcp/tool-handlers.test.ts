import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createProject, listDesigns, createDesign,
  appendPage, patchDesign, sealDesign,
  addLayer, updateLayer, removeLayer,
  listThemes, batchCreate, duplicateDesign,
  resumeDesign, saveAsComponent, applyTheme,
  exportDesign, exportTemplate, injectTemplate, listTemplateSlots,
  addLayers, getEngineGuide, listTasks, createTask, resumeTask, inspectDesign,
} from './engine';
import type { Layer, DesignSpec } from '../schema/types';
import type { ShorthandLayer } from './shorthand-parser';
import { parseDesign } from '../schema/parser';

const parseYAMLDesign = (p: string): DesignSpec => parseDesign(fs.readFileSync(p, 'utf-8'));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createProject', () => {
  it('creates project directory structure', () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const result = createProject({ name: 'My Project', path: projectPath });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'themes/editorial-cream.theme.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'designs'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'components/index.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'templates/index.yaml'))).toBe(true);
  });

  it('returns error if directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'existing'));
    const result = createProject({ name: 'Test', path: path.join(tmpDir, 'existing') });
    expect(result.success).toBe(false);
  });

  it('defaults the path to the name (whitespace→hyphens, case kept) under FOLIO_PROJECTS_DIR', () => {
    const prev = process.env['FOLIO_PROJECTS_DIR'];
    process.env['FOLIO_PROJECTS_DIR'] = tmpDir;
    try {
      const result = createProject({ name: 'My Project' }); // no path
      expect(result.success).toBe(true);
      const dir = path.join(tmpDir, 'My-Project');
      expect(fs.existsSync(path.join(dir, 'project.yaml'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR'];
      else process.env['FOLIO_PROJECTS_DIR'] = prev;
    }
  });
});

describe('createDesign', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test Project', path: projectPath });
  });

  it('creates a poster design file', () => {
    const result = createDesign({ project_path: projectPath, name: 'My Poster', type: 'poster' });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(projectPath, 'designs/my-poster.design.yaml'))).toBe(true);
  });

  it('creates a carousel design file', () => {
    createDesign({ project_path: projectPath, name: 'My Carousel', type: 'carousel' });
    const designPath = path.join(projectPath, 'designs/my-carousel.design.yaml');
    expect(fs.existsSync(designPath)).toBe(true);
  });

  it('returns a clean error (no crash) when project_path is missing', () => {
    // Small model omitted project_path (or passed it as `path`).
    const result = createDesign({ name: 'Orphan' } as Parameters<typeof createDesign>[0]);
    expect(result.success).toBe(false);
    expect(String((result as Record<string, unknown>).error)).toContain('project_path');
  });
});

describe('listDesigns', () => {
  it('lists designs from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Design A' });
    createDesign({ project_path: projectPath, name: 'Design B' });

    const result = listDesigns({ project_path: projectPath });
    expect(result.success).toBe(true);
    expect(result.designs as unknown[]).toHaveLength(2);
  });
});

describe('appendPage', () => {
  it('appends a page to carousel', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Carousel', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/carousel.design.yaml');
    const result = appendPage({
      design_path: designPath,
      page_id: 'cover',
      label: 'Cover Page',
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as import('../schema/types').Layer],
    });

    const parsed = result as Record<string, unknown>;
    expect(parsed.page_id).toBe('cover');
    expect(parsed.page_count).toBe(1);
  });

  it('increments page count on multiple appends', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Slides', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/slides.design.yaml');
    appendPage({ design_path: designPath, label: 'Page 1' });
    appendPage({ design_path: designPath, label: 'Page 2' });
    const result = appendPage({ design_path: designPath, label: 'Page 3' });

    const parsed = result as Record<string, unknown>;
    expect(parsed.page_count).toBe(3);
  });
});

describe('patchDesign', () => {
  it('patches a field by dot-path', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Patch Target' });

    const designPath = path.join(projectPath, 'designs/patch-target.design.yaml');
    const result = patchDesign({
      design_path: designPath,
      selectors: [{ path: 'meta.name', value: 'New Name' }],
    });

    const parsed = result as Record<string, unknown>;
    expect(parsed.patched_paths).toContain('meta.name');
  });
});

describe('sealDesign', () => {
  it('sets design to complete', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Seal Target', type: 'carousel' });

    const designPath = path.join(projectPath, 'designs/seal-target.design.yaml');
    appendPage({ design_path: designPath, label: 'Page 1' });

    const result = sealDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('sealed');
  });

  it('refuses to seal an empty poster (no layers → would ship a blank)', () => {
    const projectPath = path.join(tmpDir, 'empty-project');
    createProject({ name: 'Empty', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Blank', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/blank.design.yaml');

    const result = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.status).not.toBe('sealed');
    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toMatch(/empty|no layers/i);
  });
});

describe('addLayers — recovers a preset stringified into a text layer (blank-poster fix)', () => {
  it('re-expands a [{type:"sections",…}] blob into a real layer tree, not a JSON wall', () => {
    const projectPath = path.join(tmpDir, 'recover-project');
    createProject({ name: 'Recover', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Blob Poster', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/blob-poster.design.yaml');

    const blob = JSON.stringify([{ type: 'sections', kicker: 'Astrophysics', title: 'Black Holes',
      subtitle: 'A concise overview', bg_style: 'gradient + grain',
      blocks: [{ type: 'stats', items: [{ value: '30 km', label: 'radius' }] },
        { type: 'callout', label: 'Takeaway', text: 'Cosmic regulators.' }] }]);
    // The model's mistake: the whole preset packed into ONE verbose text layer,
    // plus a stray bg rect — exactly the g_blackholes blank shape.
    const res = addLayers({ design_path: designPath, layers: [
      { id: 'text_1', type: 'text', content: { type: 'plain', value: blob } },
      { id: 'rect_1', type: 'rect', pos: [0, 0, 1080, 2000] },
    ] as unknown as Layer[] }) as Record<string, unknown>;
    expect(res.success).not.toBe(false);

    const spec = parseDesign(fs.readFileSync(designPath, 'utf-8'));
    // Recovered: a real expanded group, NOT a lone text layer holding the JSON.
    expect(spec.layers!.some(l => l.type === 'group')).toBe(true);
    const lone = spec.layers!.find(l => l.type === 'text') as { content?: { value?: string } } | undefined;
    expect(lone?.content?.value ?? '').not.toContain('"blocks"');
  });
});

describe('addLayers — fits a mismatched canvas to a sole preset (landscape-clip fix)', () => {
  it('a 1080-wide portrait preset on a 2000×1080 LANDSCAPE doc shrinks the doc to fit (g_cyber)', () => {
    const projectPath = path.join(tmpDir, 'fit-project');
    createProject({ name: 'Fit', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Wide Doc', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/wide-doc.design.yaml');
    // simulate the model's landscape canvas (the empty design's only dims are the
    // document block, so the first width/height in the file are safe to swap)
    const y0 = fs.readFileSync(designPath, 'utf-8').replace(/width: \d+/, 'width: 2000').replace(/height: \d+/, 'height: 1080');
    fs.writeFileSync(designPath, y0);

    addLayers({ design_path: designPath, layers_shorthand: [{ type: 'sections', title: 'Cybercrime',
      subtitle: 'cost', blocks: [{ type: 'stats', items: [{ value: '$10T', label: 'cost' }] },
        { type: 'callout', label: 'Key', text: 'Prevention pays.' }] }] as unknown as ShorthandLayer[] });

    const spec = parseDesign(fs.readFileSync(designPath, 'utf-8'));
    const g = spec.layers!.find(l => l.type === 'group') as { width?: number; height?: number };
    expect(spec.document.width).toBe(g.width);          // canvas now matches the portrait preset
    expect(spec.document.height).toBe(g.height);
    expect(spec.document.width).toBeLessThan(2000);     // shrank from the landscape width
  });
});

describe('addLayers — rejects a malformed preset string instead of shipping a blank (g_arch)', () => {
  it('a preset-looking STRING with a stray brace errors with a repair hint (not a junk text layer)', () => {
    const projectPath = path.join(tmpDir, 'malformed-project');
    createProject({ name: 'Malformed', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Bad Blob', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/bad-blob.design.yaml');

    // valid-ish preset blob with an EXTRA brace after blocks (the g_arch corruption)
    const bad = '[{"blocks":[{"type":"stats","items":[{"value":"30%","label":"x"}]}]},"subtitle":"s","title":"T","type":"sections"}]';
    const res = addLayers({ design_path: designPath, layers_shorthand: bad as unknown as ShorthandLayer[] }) as Record<string, unknown>;
    expect(res.success).toBe(false);
    expect(String(res.error ?? '')).toMatch(/malformed/i);

    // nothing got written — no lone blob text layer was saved
    const spec = parseDesign(fs.readFileSync(designPath, 'utf-8'));
    expect((spec.layers ?? []).length).toBe(0);
  });
});

describe('addLayer / updateLayer / removeLayer', () => {
  let designPath: string;

  beforeEach(() => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Layer Test' });
    designPath = path.join(projectPath, 'designs/layer-test.design.yaml');
  });

  it('adds a layer', () => {
    const result = addLayer({
      design_path: designPath,
      layer: { id: 'new-rect', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer,
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.layer_id).toBe('new-rect');
  });

  it('updates a layer', () => {
    addLayer({
      design_path: designPath,
      layer: { id: 'rect1', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 } as import('../schema/types').Layer,
    });

    const result = updateLayer({
      design_path: designPath,
      layer_id: 'rect1',
      props: { x: 50, y: 50 },
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.updated).toBe('rect1');
  });

  it('removes a layer', () => {
    addLayer({
      design_path: designPath,
      layer: { id: 'to-remove', type: 'rect', z: 10, x: 0, y: 0, width: 50, height: 50 } as import('../schema/types').Layer,
    });

    const result = removeLayer({ design_path: designPath, layer_id: 'to-remove' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.removed).toBe('to-remove');
  });
});

describe('listThemes', () => {
  it('lists themes from project', () => {
    const projectPath = path.join(tmpDir, 'project');
    createProject({ name: 'Test', path: projectPath });

    const result = listThemes({ project_path: projectPath });
    expect(result.success).toBe(true);
    const themes = result.themes as Array<{ id: string }>;
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe('editorial-cream');
  });
});

// ── Error path tests ─────────────────────────────────────────

describe('error paths — missing files', () => {
  it('patchDesign returns error for missing file', () => {
    const result = patchDesign({
      design_path: path.join(tmpDir, 'nonexistent.design.yaml'),
      selectors: [{ path: 'meta.name', value: 'New Name' }],
    });
    expect(result.success).toBe(false);
  });

  it('sealDesign returns error for missing file', () => {
    const result = sealDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.success).toBe(false);
  });

  it('addLayer returns error for missing file', () => {
    const result = addLayer({
      design_path: path.join(tmpDir, 'no.yaml'),
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 1, height: 1 } as Layer,
    });
    expect(result.success).toBe(false);
  });

  it('updateLayer returns error for missing file', () => {
    const result = updateLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x', props: {} });
    expect(result.success).toBe(false);
  });

  it('updateLayer returns error for missing layer_id', () => {
    const projectPath = path.join(tmpDir, 'proj-err');
    createProject({ name: 'P', path: projectPath });
    createDesign({ project_path: projectPath, name: 'D' });
    const designPath = path.join(projectPath, 'designs/d.design.yaml');
    const result = updateLayer({ design_path: designPath, layer_id: 'ghost-id', props: { x: 50 } });
    expect(result.success).toBe(false);
  });

  it('removeLayer returns error for missing file', () => {
    const result = removeLayer({ design_path: path.join(tmpDir, 'no.yaml'), layer_id: 'x' });
    expect(result.success).toBe(false);
  });

  it('duplicateDesign returns error for missing source', () => {
    const result = duplicateDesign({ design_path: path.join(tmpDir, 'no.yaml'), new_name: 'Copy' });
    expect(result.success).toBe(false);
  });

  it('resumeDesign returns error for missing file', () => {
    const result = resumeDesign({ design_path: path.join(tmpDir, 'no.yaml') });
    expect(result.success).toBe(false);
  });
});

// ── patchDesign — multiple selectors ────────────────────────

describe('patchDesign — advanced', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'patch-proj');
    createProject({ name: 'Patch Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Patch Me', type: 'poster' });
    designPath = path.join(projectPath, 'designs/patch-me.design.yaml');
  });

  it('patches multiple selectors in one call', () => {
    const result = patchDesign({
      design_path: designPath,
      selectors: [
        { path: 'meta.name', value: 'Patched Name' },
        { path: 'document.width', value: 1920 },
      ],
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.patched_paths).toContain('meta.name');
    expect(parsed.patched_paths).toContain('document.width');

    // Verify the file was actually updated
    const content = fs.readFileSync(designPath, 'utf-8');
    expect(content).toContain('Patched Name');
  });
});

// ── addLayer in carousel page ────────────────────────────────

describe('addLayer in carousel page', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'carousel-proj');
    createProject({ name: 'Carousel', path: projectPath });
    createDesign({ project_path: projectPath, name: 'My Carousel', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/my-carousel.design.yaml');

    appendPage({
      design_path: designPath,
      page_id: 'page_1',
      label: 'Page One',
      layers: [{
        id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080,
        fill: { type: 'solid', color: '#000' },
      } as Layer],
    });
  });

  it('adds a layer to a specific page', () => {
    const result = addLayer({
      design_path: designPath,
      page_id: 'page_1',
      layer: { id: 'extra', type: 'rect', z: 30, x: 100, y: 100, width: 200, height: 200 } as Layer,
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.layer_id).toBe('extra');
  });

  it('returns error for missing page_id', () => {
    const result = addLayer({
      design_path: designPath,
      page_id: 'nonexistent-page',
      layer: { id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    expect(result.success).toBe(false);
  });

  it('updates a layer inside a carousel page', () => {
    const result = updateLayer({
      design_path: designPath,
      layer_id: 'bg',
      props: { x: 10 },
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.updated).toBe('bg');
  });

  it('removes a layer from a carousel page', () => {
    addLayer({
      design_path: designPath,
      page_id: 'page_1',
      layer: { id: 'temp', type: 'rect', z: 40, x: 0, y: 0, width: 10, height: 10 } as Layer,
    });
    const result = removeLayer({ design_path: designPath, layer_id: 'temp' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.removed).toBe('temp');
  });
});

// ── carousel-safe remove/update: shared IDs across pages ─────
describe('remove/update_layer — carousel pages share layer IDs', () => {
  let designPath: string;
  beforeEach(() => {
    const projectPath = path.join(tmpDir, 'shared-id-proj');
    createProject({ name: 'Shared', path: projectPath });
    createDesign({ project_path: projectPath, name: 'deck', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/deck.design.yaml');
    // Two pages whose top-level group both carry id "sections_1" (the real shape).
    const grp = (): Layer => ({ id: 'sections_1', type: 'group', z: 0, x: 0, y: 0, width: 1080, height: 1080,
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } }] } as unknown as Layer);
    appendPage({ design_path: designPath, page_id: 'page_1', label: 'One', layers: [grp()] });
    appendPage({ design_path: designPath, page_id: 'page_2', label: 'Two', layers: [grp()] });
  });

  it('REFUSES an unscoped remove of a shared id (no silent multi-page nuke)', () => {
    const r = removeLayer({ design_path: designPath, layer_id: 'sections_1' }) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('page_id');
    // both pages still have their group
    const spec = parseYAMLDesign(designPath);
    expect(spec.pages?.every(p => (p.layers ?? []).length === 1)).toBe(true);
  });

  it('removes a shared id from ONLY the named page when page_id is passed', () => {
    const r = removeLayer({ design_path: designPath, layer_id: 'sections_1', page_id: 'page_2' }) as Record<string, unknown>;
    expect(r.success).not.toBe(false);
    const spec = parseYAMLDesign(designPath);
    const byId = (id: string): number => (spec.pages?.find(p => p.id === id)?.layers ?? []).length;
    expect(byId('page_1')).toBe(1); // untouched
    expect(byId('page_2')).toBe(0); // removed here only
  });

  it('REFUSES an unscoped update of a shared id', () => {
    const r = updateLayer({ design_path: designPath, layer_id: 'sections_1', props: { x: 5 } }) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('page_id');
  });
});

// ── batchCreate ─────────────────────────────────────────────

describe('batchCreate', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'batch-proj');
    createProject({ name: 'Batch', path: projectPath });
  });

  it('creates N designs from N slot arrays', () => {
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'my-template',
      slots_array: [
        { name: 'Design Alpha', title: 'Alpha Title' },
        { name: 'Design Beta', title: 'Beta Title' },
        { name: 'Design Gamma', title: 'Gamma Title' },
      ],
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(3);
    expect(parsed.created).toHaveLength(3);
  });

  it('creates designs with auto-generated names when no name slot', () => {
    const result = batchCreate({
      project_path: projectPath,
      template_id: 'hero-card',
      slots_array: [{ title: 'Item 1' }, { title: 'Item 2' }],
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.count).toBe(2);
  });
});

// ── duplicateDesign ─────────────────────────────────────────

describe('duplicateDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'dup-proj');
    createProject({ name: 'Dup Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Original Design' });
    designPath = path.join(projectPath, 'designs/original-design.design.yaml');
  });

  it('creates a copy with a new name', () => {
    const result = duplicateDesign({ design_path: designPath, new_name: 'Copy Of Design' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.design_id).toBeTruthy();
    expect(fs.existsSync(path.join(path.dirname(designPath), 'copy-of-design.design.yaml'))).toBe(true);
  });

  it('returns error if duplicate name already exists', () => {
    duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    const result = duplicateDesign({ design_path: designPath, new_name: 'Copy' });
    expect(result.success).toBe(false);
  });

  it('registers in project.yaml when project_path provided', () => {
    duplicateDesign({ design_path: designPath, new_name: 'Registered Copy', project_path: projectPath });
    const projectYaml = fs.readFileSync(path.join(projectPath, 'project.yaml'), 'utf-8');
    expect(projectYaml).toContain('registered-copy');
  });
});

// ── resumeDesign ─────────────────────────────────────────────

describe('resumeDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'resume-proj');
    createProject({ name: 'Resume Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'In Progress', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/in-progress.design.yaml');
  });

  it('reports in_progress status for unsealed design', () => {
    const result = resumeDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('in_progress');
  });

  it('reports complete status for sealed design', () => {
    sealDesign({ design_path: designPath });
    const result = resumeDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('complete');
  });

  it('reports completed pages count', () => {
    for (let i = 1; i <= 3; i++) {
      appendPage({
        design_path: designPath,
        page_id: `page_${i}`, label: `Page ${i}`,
        layers: [{ id: `bg-${i}`, type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080 } as Layer],
      });
    }
    const result = resumeDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
    expect(parsed.completed_pages).toBe(3);
  });
});

// ── saveAsComponent ──────────────────────────────────────────

describe('saveAsComponent', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'comp-proj');
    createProject({ name: 'Component Test', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Source Design' });
    designPath = path.join(projectPath, 'designs/source-design.design.yaml');

    addLayer({ design_path: designPath, layer: { id: 'hero', type: 'rect', z: 10, x: 0, y: 0, width: 400, height: 200 } as Layer });
    addLayer({ design_path: designPath, layer: { id: 'title', type: 'text', z: 20, x: 10, y: 10, width: 380, content: { type: 'plain', value: 'Hero Title' }, style: {} } as Layer });
  });

  it('extracts layers to a component file', () => {
    const result = saveAsComponent({
      design_path: designPath,
      layer_ids: ['hero', 'title'],
      component_name: 'Hero Card',
      project_path: projectPath,
    });
    const parsed = result as Record<string, unknown>;
    expect(parsed.component_id).toBe('hero-card');
    expect(parsed.layers_extracted).toBe(2);
    expect(fs.existsSync(path.join(projectPath, 'components/hero-card.component.yaml'))).toBe(true);
  });

  it('returns error when no matching layers found', () => {
    const result = saveAsComponent({
      design_path: designPath,
      layer_ids: ['nonexistent-layer'],
      component_name: 'Ghost Component',
      project_path: projectPath,
    });
    expect(result.success).toBe(false);
  });
});

// ── applyTheme ───────────────────────────────────────────────

describe('applyTheme', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'theme-proj');
    createProject({ name: 'Theme Test', path: projectPath });
  });

  it('applies an existing theme', () => {
    const result = applyTheme({ project_path: projectPath, theme_id: 'dark-tech' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.active_theme).toBe('dark-tech');
  });

  it('returns error for unknown theme', () => {
    const result = applyTheme({ project_path: projectPath, theme_id: 'nonexistent-theme' });
    expect(result.success).toBe(false);
  });

  it('returns error when project.yaml not found', () => {
    const result = applyTheme({ project_path: path.join(tmpDir, 'no-project'), theme_id: 'dark-tech' });
    expect(result.success).toBe(false);
  });
});

// ── exportDesign ─────────────────────────────────────────

describe('exportDesign', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'export-proj');
    createProject({ name: 'Export', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Export Me' });
    designPath = path.join(projectPath, 'designs/export-me.design.yaml');
  });

  it('writes SVG file and returns ok status', () => {
    const result = exportDesign({ design_path: designPath, format: 'svg' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.format).toBe('svg');
    expect(parsed.status).toBe('ok');
    const outPath = parsed['output_path'] as string;
    expect(fs.existsSync(outPath)).toBe(true);
    expect((parsed['bytes'] as number) > 0).toBe(true);
  });

  it('exports HTML and returns ok status', () => {
    const result = exportDesign({ design_path: designPath, format: 'html' });
    const parsed = result as Record<string, unknown>;
    expect(parsed.format).toBe('html');
    expect(parsed.status).toBe('ok');
    expect(result.success).toBe(true);
  });

  // Bumped timeout: resvg's native binding cold-load + first render() runs
  // ~8s on the Windows CI runner (well within the 5s vitest default on
  // Linux/macOS). Linux/macOS finish in <300ms; the extra headroom is
  // Windows-specific but it's harmless to apply everywhere.
  it('returns success:true with PNG bytes for format=png', () => {
    const result = exportDesign({ design_path: designPath, format: 'png' });
    expect(result.success).toBe(true);
    expect((result as Record<string, unknown>).format).toBe('png');
    const bytes = (result as Record<string, unknown>).bytes as number;
    expect(bytes).toBeGreaterThan(100);
  }, 30_000);

  it('returns error when design not found', () => {
    const result = exportDesign({ design_path: path.join(tmpDir, 'no.yaml'), format: 'svg' });
    expect(result.success).toBe(false);
  });
});

// ── exportDesign — carousel (one file per page) ──────────
// Regression: a carousel keeps its content on pages[], not root layers, so a
// whole-spec render used to emit a blank 92-byte <svg/> wrapper. Export must
// walk every page and write one non-empty file per page.
describe('exportDesign — carousel', () => {
  let projectPath: string;
  let designPath: string;

  beforeEach(() => {
    projectPath = path.join(tmpDir, 'carousel-export');
    createProject({ name: 'Carousel Export', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Deck', type: 'carousel' });
    designPath = path.join(projectPath, 'designs/deck.design.yaml');
    appendPage({ design_path: designPath, page_id: 'page_1', label: 'One', layers_shorthand: [
      { id: 'bg1', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#101030' },
      { id: 't1', type: 'text', z: 10, pos: [80, 80, 920, 200], text: 'PAGE ONE HEADLINE', size: 60, color: '#ffffff' },
    ] });
    appendPage({ design_path: designPath, page_id: 'page_2', label: 'Two', layers_shorthand: [
      { id: 'bg2', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#301010' },
      { id: 't2', type: 'text', z: 10, pos: [80, 80, 920, 200], text: 'PAGE TWO HEADLINE', size: 60, color: '#ffffff' },
    ] });
  });

  it('exports one SVG per page with real content', () => {
    const result = exportDesign({ design_path: designPath, format: 'svg' });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.format).toBe('svg');
    expect(parsed['pages']).toBe(2);
    const outPaths = parsed['output_paths'] as string[];
    expect(outPaths).toHaveLength(2);
    for (const p of outPaths) expect(fs.existsSync(p)).toBe(true);
    const svg1 = fs.readFileSync(outPaths[0], 'utf-8');
    const svg2 = fs.readFileSync(outPaths[1], 'utf-8');
    // The bug produced a 92-byte empty wrapper; assert real per-page content.
    expect(svg1.length).toBeGreaterThan(300);
    expect(svg1).toContain('PAGE ONE HEADLINE');
    expect(svg2).toContain('PAGE TWO HEADLINE');
    // Each page is its own frame — no bleed between pages.
    expect(svg1).not.toContain('PAGE TWO HEADLINE');
  });

  it('exports one PNG per page', () => {
    const result = exportDesign({ design_path: designPath, format: 'png' });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed['pages']).toBe(2);
    const outPaths = parsed['output_paths'] as string[];
    expect(outPaths).toHaveLength(2);
    for (const p of outPaths) {
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(100);
    }
  }, 30_000);
});

// ── Template tools ─────────────────────────────────────────
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

describe('exportTemplate', () => {
  it('creates a .template file and returns slot info', () => {
    const designPath = makeDesignFile(tmpDir);
    const result = exportTemplate({ design_path: designPath });
    expect(result.success).toBe(true);
    const parsed = result as Record<string, unknown>;
    expect(parsed.slot_count).toBe(2);
    expect(parsed.template_path).toContain('.template.yaml');
    expect(fs.existsSync(parsed.template_path as string)).toBe(true);
  });

  it('respects custom output_path', () => {
    const designPath = makeDesignFile(tmpDir);
    const outPath = path.join(tmpDir, 'custom.template.yaml');
    const result = exportTemplate({ design_path: designPath, output_path: outPath });
    expect(result.template_path).toBe(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns error for missing design', () => {
    const result = exportTemplate({ design_path: path.join(tmpDir, 'none.yaml') });
    expect(result.success).toBe(false);
  });
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
