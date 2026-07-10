import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProject, createDesign, appendPage, sealDesign, addLayers, inspectDesign } from './engine';
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

describe('sealDesign', () => {
  const hasMotif = (spec: { layers?: Layer[] }): boolean =>
    (spec.layers ?? []).some(l => {
      const m = (l as unknown as { meta?: { role?: string } }).meta;
      return m?.role === 'motif';
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

  it('replace:true overwrites an existing page IN PLACE — order + other pages byte-identical (WP-3.3)', () => {
    const projectPath = path.join(tmpDir, 'pgreplace-project');
    createProject({ name: 'PgReplace', path: projectPath });
    createDesign({ project_path: projectPath, name: 'PgReplace', type: 'carousel', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/pgreplace.design.yaml');
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      appendPage({ design_path: designPath, page_id: id, label: id.toUpperCase(),
        layers_shorthand: [{ type: 'sections', title: `Slide ${id}`, blocks: [{ kind: 'text', text: id }] }] as unknown as ShorthandLayer[] });
    }
    const before = parseYAMLDesign(designPath);
    const othersBefore = (before.pages ?? []).filter(p => p.id !== 'p3');

    const res = appendPage({ design_path: designPath, page_id: 'p3', replace: true,
      layers_shorthand: [{ type: 'sections', title: 'Rewritten middle', blocks: [{ kind: 'text', text: 'new' }] }] as unknown as ShorthandLayer[] });
    expect(res.success).toBe(true);
    expect((res as unknown as { page_id: string }).page_id).toBe('p3');
    expect((res as unknown as { page_count: number }).page_count).toBe(5);

    const after = parseYAMLDesign(designPath);
    expect((after.pages ?? []).map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);   // order preserved, no p3-2
    const othersAfter = (after.pages ?? []).filter(p => p.id !== 'p3');
    expect(JSON.stringify(othersAfter)).toBe(JSON.stringify(othersBefore));                // untouched pages identical
    const p3 = (after.pages ?? []).find(p => p.id === 'p3');
    expect(JSON.stringify(p3)).toContain('Rewritten middle');                              // content actually replaced
    expect(p3?.label).toBe('P3');                                                          // label kept when not passed
  });

  it('same page_id WITHOUT replace still renames (back-compat) and hints at replace:true', () => {
    const projectPath = path.join(tmpDir, 'pghint-project');
    createProject({ name: 'PgHint', path: projectPath });
    createDesign({ project_path: projectPath, name: 'PgHint', type: 'carousel', width: 1080, height: 1080 });
    const designPath = path.join(projectPath, 'designs/pghint.design.yaml');
    appendPage({ design_path: designPath, page_id: 'cover', layers_shorthand: [{ type: 'sections', title: 'A', blocks: [{ kind: 'text', text: 'a' }] }] as unknown as ShorthandLayer[] });
    const res = appendPage({ design_path: designPath, page_id: 'cover', layers_shorthand: [{ type: 'sections', title: 'B', blocks: [{ kind: 'text', text: 'b' }] }] as unknown as ShorthandLayer[] });
    const prog = JSON.stringify((res as unknown as { progress?: unknown[] }).progress ?? []);
    expect(prog).toContain('replace:true');
    const ids = (parseYAMLDesign(designPath).pages ?? []).map(p => p.id);
    expect(ids).toEqual(['cover', 'cover-2']);
  });

  it('HONORS a deliberate 1080×1920 (9:16) even for short content — bg fills, no shrink', () => {
    const projectPath = path.join(tmpDir, 'fitbg-project');
    createProject({ name: 'FitBg', path: projectPath });
    createDesign({ project_path: projectPath, name: 'FitBg', type: 'poster', width: 1080, height: 1920 });
    const designPath = path.join(projectPath, 'designs/fitbg.design.yaml');
    // A full-canvas backdrop rect + ONE thin sections group. 1080×1920 is a
    // standard 9:16 ratio the user deliberately chose, so the short content keeps
    // the requested canvas (content top-anchored, backdrop filling) instead of
    // collapsing the doc to the ~972 content height.
    addLayers({ design_path: designPath, layers_shorthand: [
      { type: 'rect', pos: [0, 0, 1080, 1920], fill: '#A8B6A2' },
      { type: 'sections', title: 'In Praise of Doing Less', subtitle: 'x', blocks: [{ kind: 'text', text: 'A short line.' }] },
    ] as unknown as ShorthandLayer[] });
    const spec = parseYAMLDesign(designPath);
    const grp = (spec.layers ?? []).find(l => l.type === 'group') as unknown as { height: number };
    expect(spec.document.height).toBe(1920);  // requested 9:16 kept, NOT shrunk
    expect(grp.height).toBe(1920);             // content group fills the canvas
    const rect = (spec.layers ?? []).find(l => l.type === 'rect') as unknown as { height: number };
    expect(rect.height).toBe(1920);            // backdrop fills the whole canvas
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
