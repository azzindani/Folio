import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProject, createDesign, appendPage, sealDesign, addLayers, createPresentation } from './engine';
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

});
