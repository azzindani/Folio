import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProject, createDesign, appendPage, patchDesign, sealDesign, addLayer, updateLayer, removeLayer, listThemes, batchCreate, duplicateDesign, resumeDesign, saveAsComponent, applyTheme, exportDesign, exportTemplate, addLayers } from './engine';
import type { Layer, DesignSpec } from '../schema/types';
import type { ShorthandLayer } from './shorthand-parser';
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
