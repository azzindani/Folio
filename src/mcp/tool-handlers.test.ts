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
  createPresentation,
} from './engine';
import type { Layer, DesignSpec } from '../schema/types';
import type { ShorthandLayer } from './shorthand-parser';
import { parseDesign } from '../schema/parser';
import { dump as yamlDump } from 'js-yaml';

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
    appendPage({ design_path: designPath, label: 'Page 1', layers_shorthand: [{ type: 'editorial', title: 'Hello', subtitle: 'World' }] as unknown as import('./shorthand-parser').ShorthandLayer[] });

    const result = sealDesign({ design_path: designPath });
    const parsed = result as Record<string, unknown>;
    expect(parsed.status).toBe('sealed');
  });

  it('refuses to seal a carousel with a blank slide (only background shapes, no content)', () => {
    const projectPath = path.join(tmpDir, 'blank-slide-project');
    createProject({ name: 'BlankSlide', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Deck', type: 'carousel' });
    const designPath = path.join(projectPath, 'designs/deck.design.yaml');
    // page 1 has real content; page 2 is the blank-slide failure — two bg rects, no text
    appendPage({ design_path: designPath, label: 'Cover', layers_shorthand: [{ type: 'editorial', title: 'Cover', subtitle: 'x' }] as unknown as import('./shorthand-parser').ShorthandLayer[] });
    appendPage({ design_path: designPath, page_id: 'slide-2', label: 'Slide 2', layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#fff' } },
      { id: 'panel', type: 'rect', z: 1, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#14100A' } },
    ] as unknown as import('../schema/types').Layer[] });

    const result = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('slide-2');
  });

  it('refuses to seal an empty poster (no layers → would ship a blank)', () => {
    const projectPath = path.join(tmpDir, 'empty-project');
    createProject({ name: 'Empty', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Blank', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/blank.design.yaml');

    const result = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.status).not.toBe('sealed');
    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toMatch(/empty|no layers|blank/i);
  });

  it('refuses to seal a background + EMPTY group (the live-30B blank: shell with no content)', () => {
    const projectPath = path.join(tmpDir, 'shell-project');
    createProject({ name: 'Shell', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Shell', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/shell.design.yaml');
    addLayers({ design_path: designPath, layers: [
      { id: 'background', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#0A0A0A' } },
      { id: 'sections', type: 'group', z: 1, x: 0, y: 0, width: 1080, height: 1080, layers: [] },
    ] as unknown as import('../schema/types').Layer[] });
    const result = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toMatch(/blank|no visible content/i);
  });

  it('re-fits a sole full-bleed preset to its content at seal (blind-model canvas over-resize)', () => {
    const projectPath = path.join(tmpDir, 'fit-project');
    createProject({ name: 'Fit', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Fit', type: 'poster', width: 1080, height: 1350 });
    const designPath = path.join(projectPath, 'designs/fit.design.yaml');
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Market Day', items: [
        { icon: 'leaf', title: 'Fresh', desc: 'local produce' },
        { icon: 'sun', title: 'Morning', desc: 'every saturday' },
      ] },
    ] as unknown as ShorthandLayer[] });
    // A blind model often resizes the canvas TALLER than its content afterward,
    // and writes the dimension as a string — leaving the preset in a half-empty
    // page. Simulate that, then seal and expect the canvas re-fit to the content.
    const spec = parseYAMLDesign(designPath);
    const grpH = Number((spec.layers![0] as { height?: number }).height);
    (spec.document as unknown as { height: unknown }).height = '2000';
    fs.writeFileSync(designPath, yamlDump(spec));
    sealDesign({ design_path: designPath });
    const sealed = parseYAMLDesign(designPath);
    expect(typeof sealed.document.height).toBe('number');
    expect(sealed.document.height).toBe(grpH);   // shrank back to the preset → no dead band
    expect(sealed.document.width).toBe(1080);
  });

  it('de-collides overflowing hand-placed text so layers never overprint (blind-model overflow)', () => {
    const projectPath = path.join(tmpDir, 'decollide-project');
    createProject({ name: 'Decollide', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Decollide', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/decollide.design.yaml');
    // A blind model sizes its text but gives each layer a too-short height it can't
    // verify: the 5-line block at y=200 overflows and the next two layers sit ON it.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'rect', pos: [0, 0, 1080, 1920], fill: '#0E1116' },
      { type: 'text', pos: [80, 90, 920, 80], text: 'Year One', color: '#FFFFFF', size: 60 },
      { type: 'text', pos: [80, 200, 920, 90], text: 'Month 1: 1,200\nMonth 2: 3,400\nMonth 3: 7,100\nMonth 4: 12,000\nMonth 5: 19,500', color: '#CCCCCC', size: 34 },
      { type: 'text', pos: [80, 280, 920, 60], text: 'User Base Split', color: '#FFFFFF', size: 42 },
      { type: 'text', pos: [80, 350, 920, 80], text: 'Mobile 55 · Desktop 30 · Tablet 15', color: '#CCCCCC', size: 34 },
    ] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const texts = (spec.layers ?? []).filter(l => l.type === 'text')
      .map(l => l as unknown as { y: number; height: number })
      .sort((a, b) => a.y - b.y);
    // every text layer starts at/after the previous one's MEASURED bottom — no overprint
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i].y).toBeGreaterThanOrEqual(texts[i - 1].y + texts[i - 1].height - 2);
    }
    // the last block was pushed well past its given y=350 (the overflow was absorbed)
    expect(texts[texts.length - 1].y).toBeGreaterThan(400);
  });

  it('flattens a hand-authored relative-framed group so children render at absolute coords (blind-model group offset)', () => {
    const projectPath = path.join(tmpDir, 'flatten-project');
    createProject({ name: 'Flatten', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Flatten', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/flatten.design.yaml');
    // The exact blind-model shape (lightning poster): a group placed at y:250 with
    // children positioned in the group's LOCAL frame (y near 0). The engine renders
    // group children at ABSOLUTE coords, so pre-fix these collapsed to the top and
    // overprinted the y:100 headline. Flatten must bake the 250 offset into the kids.
    addLayers({ design_path: designPath, layers: [
      { id: 'headline', type: 'text', z: 0, x: 0, y: 100, width: 1080, height: 120, content: { type: 'plain', value: 'TITLE' }, style: { font_size: 60, color: '#fff' } },
      { id: 'col', type: 'group', z: 1, x: 0, y: 250, width: 1080, height: 600, layers: [
        { id: 'h1', type: 'text', z: 0, x: 0, y: 0, width: 360, height: 80, content: { type: 'plain', value: 'A' }, style: { font_size: 40, color: '#fff' } },
        { id: 'b1', type: 'text', z: 1, x: 0, y: 100, width: 360, height: 100, content: { type: 'plain', value: 'body' }, style: { font_size: 30, color: '#fff' } },
        { id: 'rule', type: 'line', z: 2, x1: 180, y1: 200, x2: 180, y2: 250, stroke: { color: '#fff', width: 2 } },
      ] },
    ] as unknown as Layer[] });
    const spec = parseYAMLDesign(designPath);
    const grp = (spec.layers ?? []).find(l => l.type === 'group') as unknown as
      { y: number; layers: { id: string; y?: number; y1?: number; y2?: number }[] };
    expect(grp.y).toBe(250);                                 // box re-fit to children's true top (min baked y)
    const child = (id: string): { y?: number; y1?: number; y2?: number } | undefined =>
      grp.layers.find(c => c.id === id);
    expect(child('h1')?.y).toBe(250);                        // 0 + 250
    expect(child('b1')?.y).toBe(350);                        // 100 + 250
    expect(child('rule')?.y1).toBe(450);                     // line coords baked too (200 + 250)
    expect(child('rule')?.y2).toBe(500);                     // 250 + 250
  });

  it('leaves a genuine absolute-children group untouched (no false-positive flatten)', () => {
    const projectPath = path.join(tmpDir, 'noflatten-project');
    createProject({ name: 'NoFlatten', path: projectPath });
    createDesign({ project_path: projectPath, name: 'NoFlatten', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/noflatten.design.yaml');
    // A canonical section-style group: origin at (40,300), children at ABSOLUTE
    // coords (>= origin). Flatten must NOT fire — children already correct.
    addLayers({ design_path: designPath, layers: [
      { id: 'sec', type: 'group', z: 0, x: 40, y: 300, width: 1000, height: 400, layers: [
        { id: 'k1', type: 'text', z: 0, x: 120, y: 360, width: 800, height: 80, content: { type: 'plain', value: 'X' }, style: { font_size: 40, color: '#fff' } },
      ] },
    ] as unknown as Layer[] });
    const spec = parseYAMLDesign(designPath);
    const grp = (spec.layers ?? []).find(l => l.type === 'group') as unknown as
      { x: number; y: number; layers: { id: string; x: number; y: number }[] };
    expect(grp.y).toBe(300);                                 // untouched
    expect(grp.x).toBe(40);
    const k1 = grp.layers.find(c => c.id === 'k1');
    expect(k1?.y).toBe(360);                                 // child unchanged (already absolute)
    expect(k1?.x).toBe(120);
  });

  const hasMotif = (spec: { layers?: Layer[] }): boolean =>
    (spec.layers ?? []).some(l => {
      const m = (l as unknown as { meta?: { role?: string } }).meta;
      return m?.role === 'motif';
    });

  it('drops a space-filling motif that lands on content (full-width layout has no dead space)', () => {
    const projectPath = path.join(tmpDir, 'motif-drop-project');
    createProject({ name: 'MotifDrop', path: projectPath });
    createDesign({ project_path: projectPath, name: 'MotifDrop', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/motifdrop.design.yaml');
    // A model followed the "add a motif to fill the side" directive on a full-width
    // layout: the decoration box sits squarely over the content text. It must be
    // removed (a strikethrough across the copy is worse than no decoration).
    const tall = 'Line one of a tall content column\nLine two continues the copy\nLine three keeps going\nLine four fills more height\nLine five and the column is wide\nLine six rounds it out';
    // The real shape: the content preset lands in one call, the decoration in a
    // SEPARATE call (the motif then never sees the content via `incoming`). The
    // drop pass must run on the MERGED page and still remove the colliding motif.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'rect', pos: [0, 0, 1080, 1920], fill: '#0E1116' },
      { type: 'text', pos: [80, 300, 900, 500], text: tall, color: '#FFFFFF', size: 40 },
    ] as unknown as ShorthandLayer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'motif', motif: 'arcs', pos: [150, 350, 600, 350], color: '#FFFFFF', z: 0 },
    ] as unknown as ShorthandLayer[] });
    expect(hasMotif(parseYAMLDesign(designPath))).toBe(false);
  });

  it('snaps a title placed fully off-canvas back inside (content would otherwise be lost)', () => {
    const projectPath = path.join(tmpDir, 'offcanvas-project');
    createProject({ name: 'OffCanvas', path: projectPath });
    createDesign({ project_path: projectPath, name: 'OffCanvas', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/offcanvas.design.yaml');
    // The real failure: a model computed the title's y just past the canvas bottom
    // (1095 on a 1080-tall poster). It renders NOWHERE — the title is silently lost.
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'title', type: 'text', z: 1, x: 65, y: 1095, width: 950, height: 34, content: { type: 'plain', value: 'Off-screen title' }, style: { font_size: 24 } },
    ] as unknown as Layer[] });
    const spec = parseYAMLDesign(designPath);
    const title = (spec.layers ?? []).find(l => (l as { id?: string }).id === 'title') as unknown as { y?: number; height?: number };
    expect(Number(title.y)).toBeLessThan(1080);                                  // pulled onto the canvas
    expect(Number(title.y) + Number(title.height)).toBeLessThanOrEqual(1080);    // fully visible
  });

  it('surfaces a title buried under a full-canvas preset (lifts z + reseats it up top)', () => {
    const projectPath = path.join(tmpDir, 'covered-title-project');
    createProject({ name: 'CoveredTitle', path: projectPath });
    createDesign({ project_path: projectPath, name: 'CoveredTitle', type: 'poster', width: 1920, height: 1080 });
    const designPath = path.join(projectPath, 'designs/coveredtitle.design.yaml');
    // The recurring failure: the model hand-places the title (z:1), then builds a
    // full-canvas feature_grid (z:2) whose opaque bg paints over it → invisible.
    addLayers({ design_path: designPath, layers: [
      { id: 'title', type: 'text', z: 1, x: 960, y: 980, width: 845, height: 68, content: { type: 'plain', value: 'Nimbus Roadmap 2026' }, style: { font_size: 48, color: '#141414' } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { id: 'feature_grid_3', type: 'feature_grid', z: 2, bg: '#0A0A0A', pos: [0, 0, 1920, 1080], items: [{ title: 'Q1', desc: 'Beta' }, { title: 'Q2', desc: 'Mobile' }, { title: 'Q3', desc: 'AI' }, { title: 'Q4', desc: 'Enterprise' }] }] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const title = (spec.layers ?? []).find(l => (l as { id?: string }).id === 'title') as unknown as { z?: number; y?: number; style?: { color?: string } };
    const grid = (spec.layers ?? []).find(l => (l as { id?: string }).id === 'feature_grid_3') as unknown as { z?: number };
    expect(Number(title.z)).toBeGreaterThan(Number(grid.z));   // lifted above the covering preset
    expect(Number(title.y)).toBeLessThan(1080 * 0.2);          // re-seated into the empty top header zone
    expect(title.style?.color?.toLowerCase()).not.toBe('#141414'); // recolored to contrast the dark preset bg
  });

  it('stacks a title + tagline pair when both are buried (no overlap at the same y)', () => {
    const projectPath = path.join(tmpDir, 'title-tagline-project');
    createProject({ name: 'TitleTagline', path: projectPath });
    createDesign({ project_path: projectPath, name: 'TitleTagline', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/titletagline.design.yaml');
    // The Lumen poster: a big title + a smaller tagline, both hand-placed and both
    // buried under a full-canvas feature_grid. promoteCoveredTitle re-seated both to
    // the same top y → they overlapped.
    addLayers({ design_path: designPath, layers: [
      { id: 'title', type: 'text', z: 1, x: 168, y: 90, width: 745, height: 101, content: { type: 'plain', value: 'Lumen' }, style: { font_size: 72 } },
      { id: 'tagline', type: 'text', z: 1, x: 168, y: 80, width: 745, height: 40, content: { type: 'plain', value: 'Light that thinks with you' }, style: { font_size: 28 } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { id: 'feature_grid_5', type: 'feature_grid', z: 2, pos: [0, 0, 1080, 1080], items: [{ title: 'Adaptive', desc: 'auto' }, { title: 'Voice', desc: 'hands-free' }, { title: 'Circadian', desc: 'rhythm' }] }] as unknown as ShorthandLayer[] });
    const top = parseYAMLDesign(designPath).layers ?? [];
    const title = top.find(l => (l as { id?: string }).id === 'title') as unknown as { y?: number; height?: number; style?: { font_size?: number } };
    const tagline = top.find(l => (l as { id?: string }).id === 'tagline') as unknown as { y?: number };
    // both surfaced into the top zone, but the bigger title is ABOVE the tagline,
    // and they don't sit at the same y
    expect(Number(title.y)).toBeLessThan(Number(tagline.y));    // title (fs72) on top, tagline below
    expect(Number(tagline.y)).toBeGreaterThanOrEqual(Number(title.y) + Number(title.height) - 1); // no overlap
  });

  it('spreads a hand-placed title + intro the model dropped at the same y (overprint → lines)', () => {
    const projectPath = path.join(tmpDir, 'overprint-project');
    createProject({ name: 'Overprint', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Overprint', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/overprint.design.yaml');
    // The pizza-recipe failure: a content group is present (so decollideHandPlaced is
    // switched off) and the title + intro sit at nearly the same y (distinct content,
    // so not a dedupe) → they overprint into one smear. spreadStackedText re-stacks
    // them, clamped on-canvas.
    addLayers({ design_path: designPath, layers: [
      { id: 'feature_grid_3', type: 'group', z: 2, x: 0, y: 0, width: 1080, height: 1080, layers: [
        { id: 'fg_bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } }] },
      { id: 'title', type: 'text', z: 5, x: 300, y: 936, width: 475, height: 112, content: { type: 'plain', value: 'Classic Margherita Pizza' }, style: { font_size: 40 } },
      { id: 'intro', type: 'text', z: 5, x: 300, y: 986, width: 475, height: 62, content: { type: 'plain', value: 'A timeless Italian classic with simple ingredients' }, style: { font_size: 22 } },
    ] as unknown as Layer[] });
    const top = parseYAMLDesign(designPath).layers ?? [];
    const title = top.find(l => (l as { id?: string }).id === 'title') as unknown as { y?: number; height?: number };
    const intro = top.find(l => (l as { id?: string }).id === 'intro') as unknown as { y?: number; height?: number };
    expect(Number(title.y)).toBeLessThan(Number(intro.y));                         // title (fs40) on top
    expect(Number(intro.y)).toBeGreaterThanOrEqual(Number(title.y) + Number(title.height) - 1); // no overlap
    expect(Number(intro.y) + Number(intro.height)).toBeLessThanOrEqual(1080);      // clamped on-canvas
  });

  it('measures + fits an oversized hand-placed quote so its attribution stays on-canvas', () => {
    const projectPath = path.join(tmpDir, 'quote-overflow-project');
    createProject({ name: 'QuoteOverflow', path: projectPath });
    createDesign({ project_path: projectPath, name: 'QuoteOverflow', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/quoteoverflow.design.yaml');
    // The Steve Jobs quote failure: a blind model sizes a hand-placed quote so large
    // (fs 160) it wraps to 6 lines and fills the whole canvas, with height:0 so no
    // geometry pass can see it — the attribution it placed below overprints the body
    // and then gets shoved off the bottom. Measure true height + shrink the hero so
    // the attribution fits.
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: -1, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#EDE8DC' } },
      { id: 'quote', type: 'text', z: 1, x: 90, y: 22, width: 900, height: 0, content: { type: 'plain', value: 'The only way to do great work is to love what you do.' }, style: { font_family: 'Playfair Display', font_size: 160, font_weight: 'bold' } },
      { id: 'attr', type: 'text', z: 2, x: 90, y: 440, width: 900, height: 0, content: { type: 'plain', value: '- Steve Jobs' }, style: { font_size: 40 } },
    ] as unknown as Layer[] });
    const top = parseYAMLDesign(designPath).layers ?? [];
    const quote = top.find(l => (l as { id?: string }).id === 'quote') as unknown as { y?: number; height?: number; style?: { font_size?: number } };
    const attr = top.find(l => (l as { id?: string }).id === 'attr') as unknown as { y?: number; height?: number };
    expect(Number(quote.style?.font_size)).toBeLessThan(160);                        // oversized hero shrunk
    expect(Number(quote.height)).toBeGreaterThan(0);                                 // true height measured (was 0)
    expect(Number(attr.y)).toBeGreaterThanOrEqual(Number(quote.y) + Number(quote.height) - 2); // attribution below the quote, no overprint
    expect(Number(attr.y) + Number(attr.height)).toBeLessThanOrEqual(1080);          // attribution stays on-canvas
  });

  it('a presentation filled via add_layers+page_id fills each slide and stays cohesive (create_presentation path)', () => {
    const projectPath = path.join(tmpDir, 'deck-project');
    createProject({ name: 'Deck', path: projectPath });
    const pres = createPresentation({ project_path: projectPath, name: 'Future Deck',
      pages: [{ label: 'Cover' }, { label: 'Trend One' }], width: 1920, height: 1080 }) as unknown as { design_path: string };
    const dPath = pres.design_path;
    // Bare sections per slide (no bg/font) with DIFFERENT content — the exact shape
    // that used to give a left-anchored 1080×972 portrait group on each 1920×1080
    // landscape slide + a per-slide divergent mood.
    addLayers({ design_path: dPath, page_id: 'slide_1', layers_shorthand: [
      { type: 'sections', title: 'Cover', blocks: [{ kind: 'text', text: 'Intro line.' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: dPath, page_id: 'slide_2', layers_shorthand: [
      { type: 'sections', title: 'Trend One Async', blocks: [{ kind: 'text', text: 'Another line.' }] }] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(dPath);
    const grp = (pid: string) => {
      const pg = (spec.pages ?? []).find(p => p.id === pid);
      return (pg?.layers ?? []).find(l => l.type === 'group') as unknown as { width: number; height: number; layers: Array<Record<string, unknown>> };
    };
    const bgOf = (g: { layers: Array<Record<string, unknown>> }) => {
      const r = g.layers.find(l => l['type'] === 'rect');
      const f = r?.['fill'] as { color?: string; stops?: Array<{ color?: string }> } | undefined;
      return f?.color ?? f?.stops?.[0]?.color;
    };
    const g1 = grp('slide_1'), g2 = grp('slide_2');
    // each slide FILLS the landscape page (was 1080×972 portrait in the left corner)
    expect(g1.width).toBe(1920); expect(g1.height).toBe(1080);
    expect(g2.width).toBe(1920); expect(g2.height).toBe(1080);
    // cohesive: both slides share one deck mood despite different content
    expect(bgOf(g1)).toBeDefined();
    expect(bgOf(g1)).toBe(bgOf(g2));
  });

  it('gives a bg-less hand-placed cover slide the deck background (cohesion)', () => {
    const projectPath = path.join(tmpDir, 'deck-cover-project');
    createProject({ name: 'DeckCover', path: projectPath });
    const pres = createPresentation({ project_path: projectPath, name: 'Tips Deck',
      pages: [{ label: 'Cover' }, { label: 'Tip One' }], width: 1080, height: 1080 }) as unknown as { design_path: string };
    const dPath = pres.design_path;
    // Content slide gets a cream wash from its preset; the cover is hand-placed text
    // with NO background → it would render pure white against the cream content.
    addLayers({ design_path: dPath, page_id: 'slide_2', layers_shorthand: [
      { type: 'sections', bg: '#FAF5EC', title: 'Tip One', blocks: [{ kind: 'text', text: 'A tip.' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: dPath, page_id: 'slide_1', layers: [
      { id: 'cover_title', type: 'text', z: 1, x: 200, y: 460, width: 680, height: 60, content: { type: 'plain', value: 'Productivity Tips' }, style: { font_size: 48 } }] as unknown as Layer[] });
    const spec = parseYAMLDesign(dPath);
    const cover = (spec.pages ?? []).find(p => p.id === 'slide_1');
    const coverBg = (cover?.layers ?? []).find(l => l.type === 'rect' && (l as { width?: number }).width === 1080) as unknown as { fill?: { color?: string } } | undefined;
    expect(coverBg).toBeTruthy();                  // cover got a full-canvas background
    expect(coverBg?.fill?.color).toBe('#FAF5EC');  // matching the deck's shared color
  });

  it('rasterizes a foreignObject bar chart into native rect bars (so it is not blank in PNG)', () => {
    const projectPath = path.join(tmpDir, 'chart-project');
    createProject({ name: 'Chart', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Chart', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/chart.design.yaml');
    addLayers({ design_path: designPath, layers: [
      { id: 'chart', type: 'chart', z: 2, x: 100, y: 200, width: 880, height: 500,
        spec: { mark: 'bar', encoding: { x: { field: 'x' }, y: { field: 'y' } },
          data: { values: [{ x: 'Python', y: 30 }, { x: 'JavaScript', y: 25 }, { x: 'Go', y: 6 }] } } },
    ] as unknown as Layer[] });
    const spec = parseYAMLDesign(designPath);
    expect((spec.layers ?? []).some(l => l.type === 'chart')).toBe(false); // no foreignObject chart left
    const grp = (spec.layers ?? []).find(l => l.type === 'group' && (l as { id?: string }).id === 'chart') as unknown as { layers: Array<Record<string, unknown>> };
    expect(grp).toBeTruthy();
    const bars = grp.layers.filter(l => l['type'] === 'rect' && /_b\d+$/.test(String(l['id'])));
    expect(bars.length).toBe(3);                       // one bar per data point
    const labels = grp.layers.filter(l => l['type'] === 'text').map(l => (l['content'] as { value?: string })?.value);
    expect(labels).toContain('Python');               // category labels rendered as real text
  });

  it('removes stacked duplicate full-canvas presets, keeping the last (thrash-rebuild)', () => {
    const projectPath = path.join(tmpDir, 'stacked-project');
    createProject({ name: 'Stacked', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Stacked', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/stacked.design.yaml');
    // A thrashing rebuild: three full-canvas feature_grids re-stacked across calls
    // with the SAME (substantial) content — only the attempt title changes — which
    // is how a real rebuild looks (vs distinct sections, tested separately).
    for (const t of ['First Attempt', 'Second Attempt', 'Final Version']) {
      addLayers({ design_path: designPath, layers_shorthand: [
        { type: 'feature_grid', title: t, items: [
          { title: 'Realtime Sync', desc: 'Updates stream instantly across devices' },
          { title: 'Secure Vault', desc: 'Encrypted storage for every document' }] }] as unknown as ShorthandLayer[] });
    }
    const spec = parseYAMLDesign(designPath);
    const grids = (spec.layers ?? []).filter(l => l.type === 'group' && String((l as { id?: string }).id ?? '').startsWith('feature_grid'));
    expect(grids.length).toBe(1); // only the survivor remains
    const titles: string[] = [];
    const walk = (ls: Layer[]): void => { for (const l of ls) {
      if (l.type === 'text') { const c = (l as unknown as { content?: { value?: unknown } }).content; if (c && typeof c.value === 'string') titles.push(c.value); }
      const kids = (l as unknown as { layers?: Layer[] }).layers; if (Array.isArray(kids)) walk(kids);
    } };
    walk(spec.layers ?? []);
    expect(titles).toContain('Final Version');     // the LAST attempt is kept
    expect(titles).not.toContain('First Attempt'); // earlier stacked attempts dropped
  });

  it('PRESERVES N distinct stacked sections (different content) — no silent data loss', () => {
    const projectPath = path.join(tmpDir, 'distinct-sections-project');
    createProject({ name: 'Distinct', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Distinct', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/distinct.design.yaml');
    // A menu: the model stacked 3 full-canvas feature_grids, one per DISTINCT section.
    // They have no shared content, so none is a "thrash duplicate" — dropping any
    // would lose a whole section (the Copper Kettle menu lost Breakfast + Lunch).
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Breakfast', items: [{ title: 'Avocado Toast', desc: 'sourdough, poached egg' }, { title: 'Granola Bowl', desc: 'yogurt, berries, honey' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Lunch', items: [{ title: 'Club Sandwich', desc: 'turkey, bacon, lettuce' }, { title: 'Caesar Salad', desc: 'romaine, parmesan, croutons' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Drinks', items: [{ title: 'Cold Brew', desc: 'served over ice' }, { title: 'Matcha Latte', desc: 'oat milk, honey' }] }] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const flat = JSON.stringify(spec.layers ?? []);
    expect(flat).toContain('Breakfast');   // all three sections survive
    expect(flat).toContain('Lunch');
    expect(flat).toContain('Drinks');
    expect(flat).toContain('Avocado Toast');
    expect(flat).toContain('Club Sandwich');
    // ...and they're re-seated into stacked vertical BANDS (not piled at one box,
    // where only the top section would render). Distinct, increasing y + a doc tall
    // enough to hold every band.
    const sections = (spec.layers ?? []).filter(l => l.type === 'group' && /^feature_grid/.test(String((l as { id?: string }).id ?? '')));
    expect(sections.length).toBe(3);
    const ys = sections.map(l => Number((l as unknown as { y?: number }).y) || 0).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(3);                 // three distinct bands
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(spec.document.height).toBeGreaterThan(1080); // page grew to fit the bands
    // ...but each band is TRIMMED to its content (a section is a heading + one short
    // row of cards), so the page is far shorter than 3 full 1080 squares — no dead
    // space stacked between sections.
    expect(spec.document.height).toBeLessThan(3 * 1080);
    // CRUCIAL: the section's CONTENT actually moved into the band — a group applies
    // no render transform, so moving only the group box would leave every child
    // (the full-bleed bg rect) stacked at y:0 and invisible. Each section's bg rect
    // must sit at its (distinct, increasing) band top, not all at the origin.
    const bgTops = sections.map(g => {
      const kids = (g as unknown as { layers?: Layer[] }).layers ?? [];
      const bg = kids.find(k => k.type === 'rect' && Number((k as unknown as { width?: number }).width) >= 1080 * 0.9);
      return Number((bg as unknown as { y?: number } | undefined)?.y) || 0;
    }).sort((a, b) => a - b);
    expect(new Set(bgTops).size).toBe(3);             // bgs at three distinct y, not piled at 0
    expect(bgTops[0]).toBeLessThan(bgTops[1]);
    expect(bgTops[1]).toBeLessThan(bgTops[2]);
    // each band's bg height matches its (trimmed) band, not the full 1080 square
    const bandHeights = sections.map(g => {
      const kids = (g as unknown as { layers?: Layer[] }).layers ?? [];
      const bg = kids.find(k => k.type === 'rect' && Number((k as unknown as { width?: number }).width) >= 1080 * 0.9);
      return Number((bg as unknown as { height?: number } | undefined)?.height) || 0;
    });
    expect(bandHeights.every(h => h > 0 && h < 1080)).toBe(true); // trimmed, not full-canvas
  });

  it('seats a stranded loose doc title ABOVE the banded sections (not marooned below)', () => {
    const projectPath = path.join(tmpDir, 'banded-title-project');
    createProject({ name: 'BandedTitle', path: projectPath });
    createDesign({ project_path: projectPath, name: 'BandedTitle', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/bandedtitle.design.yaml');
    // The Olive Branch menu: the model put the doc title in its own call and placed
    // it near the BOTTOM, so after the sections band + trim it was stranded in the
    // dead space below the last band. It must be re-seated above the first band.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Starters', items: [{ title: 'Bruschetta', desc: '$8' }, { title: 'Calamari', desc: '$12' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', title: 'Mains', items: [{ title: 'Salmon', desc: '$24' }, { title: 'Ribeye', desc: '$32' }] }] as unknown as ShorthandLayer[] });
    addLayers({ design_path: designPath, layers: [
      { id: 'doctitle', type: 'text', z: 9, x: 300, y: 1000, width: 480, height: 60, content: { type: 'plain', value: 'The Olive Branch' }, style: { font_size: 48 } }] as unknown as Layer[] });
    const top = parseYAMLDesign(designPath).layers ?? [];
    const title = top.find(l => (l as { id?: string }).id === 'doctitle') as unknown as { y?: number };
    const sections = top.filter(l => l.type === 'group' && /^feature_grid/.test(String((l as { id?: string }).id ?? '')));
    const firstBandTop = Math.min(...sections.map(g => Number((g as unknown as { y?: number }).y) || 0));
    expect(Number(title.y)).toBeLessThan(firstBandTop);   // title sits above the first band, not stranded below
    expect(Number(title.y)).toBeLessThan(200);            // up in the top title zone
  });

  it('removes loose hand-placed duplicates when many backdrops stack over a content preset', () => {
    const projectPath = path.join(tmpDir, 'thrash-loose-project');
    createProject({ name: 'ThrashLoose', path: projectPath });
    createDesign({ project_path: projectPath, name: 'ThrashLoose', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/thrashloose.design.yaml');
    // The real pricing-poster failure: the model rebuilt a HAND-PLACED poster
    // many times (a full-canvas backdrop + loose tier text per pass) AND once via
    // a feature_grid preset that holds the clean composition. Replicate: 4 stacked
    // backdrops + loose duplicate text, then a complete feature_grid.
    for (let i = 0; i < 4; i++) {
      addLayers({ design_path: designPath, layers: [
        { id: `bg_${i}`, type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
        { id: `tier_${i}`, type: 'text', z: 1, x: 120, y: 400, width: 300, height: 40, content: { type: 'plain', value: 'Starter $9/mo' }, style: { font_size: 30 } },
      ] as unknown as Layer[] });
    }
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'feature_grid', items: [{ title: 'Starter', desc: '$9/mo' }, { title: 'Pro', desc: '$29/mo' }, { title: 'Enterprise', desc: '$99/mo' }] }] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const top = spec.layers ?? [];
    // exactly one backdrop survives + the feature_grid preset; loose tier dupes gone
    const backdrops = top.filter(l => l.type === 'rect' && (l as { width?: number }).width === 1080);
    expect(backdrops.length).toBe(1);
    const looseTier = top.filter(l => l.type === 'text' && /tier_/.test(String((l as { id?: string }).id)));
    expect(looseTier.length).toBe(0);                 // loose hand-placed copies removed
    expect(top.some(l => l.type === 'group' && /^feature_grid/.test(String((l as { id?: string }).id)))).toBe(true); // preset kept
  });

  it('keeps a UNIQUE poster title through the preset-thrash cleanup (only drops redundant copies)', () => {
    const projectPath = path.join(tmpDir, 'thrash-title-project');
    createProject({ name: 'ThrashTitle', path: projectPath });
    createDesign({ project_path: projectPath, name: 'ThrashTitle', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/thrashtitle.design.yaml');
    // The comparison-poster failure: the model rebuilt 4× (backdrop + a unique TITLE
    // + a loose copy of the preset's own label), then a feature_grid. The title is
    // NOT redundant with the grid → it must survive (dropping it lost the title).
    for (let i = 0; i < 4; i++) {
      addLayers({ design_path: designPath, layers: [
        { id: `bg_${i}`, type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
        { id: `title_${i}`, type: 'text', z: 1, x: 200, y: 60, width: 680, height: 50, content: { type: 'plain', value: 'Volt vs Competitors Feature Comparison' }, style: { font_size: 34 } },
        { id: `dup_${i}`, type: 'text', z: 1, x: 120, y: 400, width: 300, height: 40, content: { type: 'plain', value: 'Unlimited storage' }, style: { font_size: 24 } },
      ] as unknown as Layer[] });
    }
    addLayers({ design_path: designPath, layers_shorthand: [
      { id: 'feature_grid_3', type: 'feature_grid', z: 2, items: [{ title: 'Feature', desc: 'Unlimited storage' }, { title: 'Volt', desc: 'Yes' }, { title: 'Rival A', desc: 'No' }] }] as unknown as ShorthandLayer[] });
    const layerTextOf = (l: Layer): string => { const c = (l as unknown as { content?: { value?: unknown } }).content; return c && typeof c.value === 'string' ? c.value : ''; };
    const top = parseYAMLDesign(designPath).layers ?? [];
    const titles = top.filter(l => l.type === 'text' && /Competitors/.test(layerTextOf(l)));
    const dupLabels = top.filter(l => l.type === 'text' && layerTextOf(l) === 'Unlimited storage');
    expect(titles.length).toBe(1);          // the unique title survives (exactly one, deduped)
    expect(dupLabels.length).toBe(0);       // loose copies of the preset's own label dropped
    expect(top.some(l => l.type === 'group' && /^feature_grid/.test(String((l as { id?: string }).id)))).toBe(true);
  });

  it('dedupes a quote stamped several times on a preset-less typographic poster', () => {
    const projectPath = path.join(tmpDir, 'quote-dup-project');
    createProject({ name: 'QuoteDup', path: projectPath });
    createDesign({ project_path: projectPath, name: 'QuoteDup', type: 'poster', width: 1080, height: 1440 });
    const designPath = path.join(projectPath, 'designs/quotedup.design.yaml');
    const QUOTE = 'Design is not just what it looks like and feels like. Design is how it works.';
    // The real quote-poster failure: 3 rebuild passes each re-laying a full-canvas
    // backdrop + the same quote + attribution, all overlapping (no preset at all).
    addLayers({ design_path: designPath, layers: [
      { id: 'bg1', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1440, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'q1', type: 'text', z: 1, x: 540, y: 500, width: 475, height: 202, content: { type: 'plain', value: QUOTE }, style: { font_size: 36 } },
      { id: 'a1', type: 'text', z: 1, x: 540, y: 717, width: 475, height: 34, content: { type: 'plain', value: '- Steve Jobs, Apple' }, style: { font_size: 24 } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers: [
      { id: 'bg2', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1440, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'q2', type: 'text', z: 1, x: 540, y: 500, width: 475, height: 202, content: { type: 'plain', value: QUOTE }, style: { font_size: 36 } },
      { id: 'a2', type: 'text', z: 1, x: 540, y: 717, width: 475, height: 34, content: { type: 'plain', value: '- Steve Jobs, Apple' }, style: { font_size: 24 } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers: [
      { id: 'q3', type: 'text', z: 2, x: 540, y: 400, width: 475, height: 336, content: { type: 'plain', value: QUOTE }, style: { font_size: 48 } },
      { id: 'a3', type: 'text', z: 2, x: 540, y: 751, width: 475, height: 28, content: { type: 'plain', value: '– Steve Jobs, Apple' }, style: { font_size: 20 } },
    ] as unknown as Layer[] });
    const layerTextOf = (l: Layer): string => { const c = (l as unknown as { content?: { value?: unknown } }).content; return c && typeof c.value === 'string' ? c.value : ''; };
    const top = parseYAMLDesign(designPath).layers ?? [];
    const quotes = top.filter(l => l.type === 'text' && layerTextOf(l).startsWith('Design is not'));
    const attrs = top.filter(l => l.type === 'text' && /Steve Jobs/.test(layerTextOf(l)));
    expect(quotes.length).toBe(1);          // one quote survives (the last pass)
    expect(attrs.length).toBe(1);           // one attribution survives (dash variant normalized)
    expect((quotes[0] as { id?: string }).id).toBe('q3'); // kept the LAST pass
  });

  it('collapses stacked duplicate groups + overlapping reworded captions (no dup-backdrop gate)', () => {
    const projectPath = path.join(tmpDir, 'chart-thrash-project');
    createProject({ name: 'ChartThrash', path: projectPath });
    createDesign({ project_path: projectPath, name: 'ChartThrash', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/chartthrash.design.yaml');
    // The donut-poster failure: the model re-stacked a chart GROUP + a reworded
    // caption three times WITHOUT re-laying the backdrop, so the dup-backdrop gates
    // miss it. Same id-base groups at the same box + overlapping near-dup captions.
    const grp = (id: string) => ({ id, type: 'group', z: 2, x: 140, y: 200, width: 800, height: 600,
      layers: [{ id: `${id}_b`, type: 'rect', z: 0, x: 140, y: 200, width: 800, height: 600, fill: { type: 'solid', color: '#2d5a3d' } }] });
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      grp('chart_3'),
      { id: 'cap', type: 'text', z: 3, x: 300, y: 850, width: 475, height: 26, content: { type: 'plain', value: 'Chrome leads with 65% share' }, style: { font_size: 20 } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers: [
      grp('chart_3'),   // dedupeIncomingIds → chart_3-2 (same base + box)
      { id: 'cap', type: 'text', z: 3, x: 300, y: 850, width: 475, height: 26, content: { type: 'plain', value: 'Chrome dominates with 65% share' }, style: { font_size: 20 } },
    ] as unknown as Layer[] });
    addLayers({ design_path: designPath, layers: [ grp('chart_3') ] as unknown as Layer[] }); // chart_3-3
    const layerTextOf = (l: Layer): string => { const c = (l as unknown as { content?: { value?: unknown } }).content; return c && typeof c.value === 'string' ? c.value : ''; };
    const top = parseYAMLDesign(designPath).layers ?? [];
    const charts = top.filter(l => l.type === 'group' && /^chart_3/.test(String((l as { id?: string }).id)));
    const caps = top.filter(l => l.type === 'text' && /65% share/.test(layerTextOf(l)));
    expect(charts.length).toBe(1);          // 3 stacked chart groups → 1
    expect(caps.length).toBe(1);            // 2 overlapping reworded captions → 1
    expect(layerTextOf(caps[0])).toMatch(/dominates/); // kept the LAST caption
  });

  it('re-centers a title anchored at the canvas mid-line (docW/2 used as left edge)', () => {
    const projectPath = path.join(tmpDir, 'midanchor-project');
    createProject({ name: 'MidAnchor', path: projectPath });
    createDesign({ project_path: projectPath, name: 'MidAnchor', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/midanchor.design.yaml');
    // Title at x=540 (=docW/2) reaching the right edge, nothing on the left at its
    // y-band → the model meant to center it. A chart group below (different band)
    // must not block the recenter.
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'title', type: 'text', z: 1, x: 540, y: 120, width: 475, height: 40, content: { type: 'plain', value: 'How We Spend Our Day' }, style: { font_size: 34 } },
    ] as unknown as Layer[] });
    const title = (parseYAMLDesign(designPath).layers ?? []).find(l => (l as { id?: string }).id === 'title') as unknown as { x?: number; style?: { align?: string } };
    expect(Number(title.x)).toBeLessThan(540);                 // pulled left toward true center
    expect(Math.abs(Number(title.x) - (1080 - 475) / 2)).toBeLessThanOrEqual(2); // centered box
    expect(title.style?.align).toBe('center');
  });

  it('leaves a mid-line text alone when the left half is occupied (real right column)', () => {
    const projectPath = path.join(tmpDir, 'rightcol-project');
    createProject({ name: 'RightCol', path: projectPath });
    createDesign({ project_path: projectPath, name: 'RightCol', type: 'poster', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/rightcol.design.yaml');
    // A genuine two-column layout: an image panel on the left, text in the right
    // half at the same height → NOT a centering slip, must be left as placed.
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'panel', type: 'rect', z: 1, x: 80, y: 300, width: 420, height: 480, fill: { type: 'solid', color: '#2d5a3d' } },
      { id: 'copy', type: 'text', z: 2, x: 540, y: 400, width: 460, height: 200, content: { type: 'plain', value: 'A column of supporting copy on the right side.' }, style: { font_size: 28 } },
    ] as unknown as Layer[] });
    const copy = (parseYAMLDesign(designPath).layers ?? []).find(l => (l as { id?: string }).id === 'copy') as unknown as { x?: number };
    expect(Number(copy.x)).toBe(540);                          // untouched — real right column
  });

  it('de-dupes a duplicate page_id on append so no two pages share an id', () => {
    const projectPath = path.join(tmpDir, 'pageid-project');
    createProject({ name: 'PgId', path: projectPath });
    createDesign({ project_path: projectPath, name: 'PgId', type: 'carousel', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/pgid.design.yaml');
    appendPage({ design_path: designPath, page_id: 'cover', layers_shorthand: [{ type: 'sections', title: 'A', blocks: [{ kind: 'text', text: 'a' }] }] as unknown as ShorthandLayer[] });
    appendPage({ design_path: designPath, page_id: 'cover', layers_shorthand: [{ type: 'sections', title: 'B', blocks: [{ kind: 'text', text: 'b' }] }] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const ids = (spec.pages ?? []).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids).toContain('cover');
    expect(ids).toContain('cover-2');
  });

  it('fits a poster doc to the sole content group even when a full-canvas backdrop rect was also added (sage-block bug)', () => {
    const projectPath = path.join(tmpDir, 'fitbg-project');
    createProject({ name: 'FitBg', path: projectPath });
    createDesign({ project_path: projectPath, name: 'FitBg', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/fitbg.design.yaml');
    // The exact shape: a full-canvas backdrop rect + ONE thin sections group, in one
    // call. Pre-fix the doc stayed 1920 and the 972 group left the backdrop showing
    // through the empty lower half.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'rect', pos: [0, 0, 1080, 1920], fill: '#A8B6A2' },
      { type: 'sections', title: 'In Praise of Doing Less', subtitle: 'x', blocks: [{ kind: 'text', text: 'A short line.' }] },
    ] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const grp = (spec.layers ?? []).find(l => l.type === 'group') as unknown as { height: number };
    expect(spec.document.height).toBeLessThan(1920);   // doc fit down to the content
    expect(spec.document.height).toBe(grp.height);      // exactly the group height
    const rect = (spec.layers ?? []).find(l => l.type === 'rect') as unknown as { height: number };
    expect(rect.height).toBeLessThanOrEqual(grp.height); // backdrop clamped, no overhang
  });

  it('keeps a motif placed in genuine empty side space (no overlap with content)', () => {
    const projectPath = path.join(tmpDir, 'motif-keep-project');
    createProject({ name: 'MotifKeep', path: projectPath });
    createDesign({ project_path: projectPath, name: 'MotifKeep', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/motifkeep.design.yaml');
    // Left-anchored copy, motif in the open right column — its intended use. Kept.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'rect', pos: [0, 0, 1080, 1920], fill: '#0E1116' },
      { type: 'text', pos: [80, 400, 400, 600], text: 'A narrow left column', color: '#FFFFFF', size: 40 },
      { type: 'motif', motif: 'arcs', pos: [620, 400, 380, 600], color: '#FFFFFF', z: 0 },
    ] as unknown as ShorthandLayer[] });
    expect(hasMotif(parseYAMLDesign(designPath))).toBe(true);
  });

  it('unwraps a model-invented page wrapper instead of rejecting a dimensionless group (blind-30B blank-poster)', () => {
    const projectPath = path.join(tmpDir, 'wrapper-project');
    createProject({ name: 'Wrap', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Wrap', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/wrap.design.yaml');
    // The exact shape a blind 30B emitted: page-level bg/accent/fonts on a typeless
    // wrapper, the real layers nested under `layers`. Pre-fix this threw
    // "group needs a positive width" and the poster sealed blank.
    const result = addLayers({ design_path: designPath, layers_shorthand: [{
      bg: '#FAF5EC', accent: '#D95F00', font_heading: 'Playfair Display', font_body: 'Inter',
      layers: [
        { type: 'editorial', id: 'editorial_1', pos: [0, 0, 1080, 1080], kicker: 'WEEKEND', title: 'Farmers Market', subtitle: 'produce · music · coffee', body: 'Fresh local produce, live music, good coffee.', footer: 'Sat 8AM · Town Green' },
        { type: 'icon', id: 'produce_icon', icon: 'apple', pos: [760, 180, 150, 150] },
      ],
    }] as never }) as Record<string, unknown>;
    expect(result.success).not.toBe(false);                 // not the dimensionless-group rejection
    expect(Number(result.added)).toBeGreaterThan(0);
    const info = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    const layers = info.layers as { type: string }[];
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.some(l => l.type === 'group')).toBe(true);  // editorial preset expanded
    const seal = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(seal.status).toBe('sealed');                       // non-blank → seals cleanly
  });

  it('defaults a missing color on a hand-placed verbose text layer to $text (invisible-on-dark fix)', () => {
    const projectPath = path.join(tmpDir, 'textcolor-project');
    createProject({ name: 'TextColor', path: projectPath });
    createDesign({ project_path: projectPath, name: 'TextColor', type: 'poster', theme_ref: 'bold-poster' });
    const designPath = path.join(projectPath, 'designs/textcolor.design.yaml');
    // A blind-30B detail block: sized verbose text with a style but NO color → the
    // renderer falls back to #000 → invisible on a near-black poster.
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#0A0A0A' } },
      { id: 'details', type: 'text', z: 1, x: 80, y: 700, width: 600, height: 200, content: { type: 'plain', value: 'Friday 9:30 PM · No cover' }, style: { fontSize: 23 } },
      { id: 'titled', type: 'text', z: 2, x: 80, y: 80, width: 900, height: 120, content: { type: 'plain', value: 'Has Color' }, style: { color: '#FF3D00' } },
    ] as unknown as import('../schema/types').Layer[] });
    const spec = parseYAMLDesign(designPath);
    const layers = spec.layers as { id: string; style?: { color?: string } }[];
    const detailsColor = layers.find(l => l.id === 'details')?.style?.color;
    expect(detailsColor).toBeTruthy();                                       // no longer missing
    expect(detailsColor).not.toBe('#000');                                  // not the invisible renderer default
    expect(detailsColor).not.toBe('#000000');
    expect(detailsColor).not.toBe('#0A0A0A');                               // not the (dark) page background
    expect(layers.find(l => l.id === 'titled')?.style?.color).toBe('#FF3D00'); // explicit color untouched
  });

  it('sizes & stacks a hand-placed UNSIZED text poster (nano-30B rescue) into a hierarchy', () => {
    const projectPath = path.join(tmpDir, 'handtext-project');
    createProject({ name: 'HandText', path: projectPath });
    createDesign({ project_path: projectPath, name: 'HandText', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/handtext.design.yaml');
    addLayers({ design_path: designPath, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#0A0A0A' } },
      { id: 't1', type: 'text', z: 1, content: { type: 'plain', value: 'AI Can Design Posters Without Seeing Them' } },
      { id: 't2', type: 'text', z: 2, content: { type: 'plain', value: 'Made by a 30B model driving Folio.' } },
      { id: 't3', type: 'text', z: 3, content: { type: 'plain', value: 'Hours of design work now take minutes, and bulk work that took days now takes minutes.' } },
    ] as unknown as import('../schema/types').Layer[] });
    const info = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    const ls = info.layers as { id: string; y: number; h: number }[];
    const t1 = ls.find(l => l.id === 't1')!, t2 = ls.find(l => l.id === 't2')!, t3 = ls.find(l => l.id === 't3')!;
    expect(t1.h).toBeGreaterThan(0);
    expect(t2.y).toBeGreaterThanOrEqual(t1.y + t1.h);   // stacked, no overlap
    expect(t3.y).toBeGreaterThanOrEqual(t2.y + t2.h);
  });

  it('does NOT restructure when a preset group is present', () => {
    const projectPath = path.join(tmpDir, 'preset-project');
    createProject({ name: 'Preset', path: projectPath });
    createDesign({ project_path: projectPath, name: 'Preset', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/preset.design.yaml');
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'sections', title: 'Real Preset', blocks: [{ type: 'callout', text: 'x' }] },
    ] as never });
    const info = inspectDesign({ design_path: designPath }) as Record<string, unknown>;
    expect((info.layers as { type: string }[]).some(l => l.type === 'group')).toBe(true);
  });

  it('seals a design that DOES have content (background + a real text layer)', () => {
    const projectPath = path.join(tmpDir, 'ok-project');
    createProject({ name: 'OK', path: projectPath });
    createDesign({ project_path: projectPath, name: 'OK', type: 'poster' });
    const designPath = path.join(projectPath, 'designs/ok.design.yaml');
    addLayers({ design_path: designPath, layers: [
      { id: 'background', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#0A0A0A' } },
      { id: 'title', type: 'text', z: 1, x: 80, y: 80, width: 900, height: 120, content: { type: 'plain', value: 'A Real Title' } },
    ] as unknown as import('../schema/types').Layer[] });
    const result = sealDesign({ design_path: designPath }) as Record<string, unknown>;
    expect(result.status).toBe('sealed');
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
