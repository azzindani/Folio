import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { customizeReport, customizePresentation, resizeDesign } from './engine-customize-tools';
import { createProject, createDesign } from './engine-project-tools';
import { generateReport, createPresentation } from './engine-report-tools';
import { addLayers } from './engine-layer-tools';
import type { ShorthandLayer } from './shorthand-helpers';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-customize-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'cz');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const SECTIONS = (id: string, w: number, h: number) => ({
  id, type: 'sections', z: 0, pos: [0, 0, w, h], bg: '#0A0A0A', accent: '#FF6B35',
  title: 'Air Cargo Performance', subtitle: 'Volume, yield and belly capacity.',
  blocks: [
    { kind: 'text', heading: 'Volume', text: 'Tonnage rose 8.4% year on year across transpacific lanes.' },
    { kind: 'text', heading: 'Yield', text: 'Average yield fell 3.1% as capacity outpaced demand.' },
  ],
} as unknown as ShorthandLayer);

/** Deepest bottom edge — where the content really ends. */
function bottom(l: Rec): number {
  let b = (Number(l['y']) || 0) + (Number(l['height']) || 0);
  for (const c of (l['layers'] as Rec[] | undefined) ?? []) b = Math.max(b, bottom(c));
  return b;
}

function read(p: string): Rec {
  const yaml = require('js-yaml') as { load(s: string): unknown };
  return yaml.load(fs.readFileSync(p, 'utf-8')) as Rec;
}

describe('report {op:"customize"} — restyle in place instead of regenerating', () => {
  let designPath: string;

  beforeEach(() => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'cz', canvas: '1080x1080' });
    const r = generateReport({ project_path: projectDir, name: `rep-${Math.random().toString(36).slice(2, 7)}`, layout: 'flow', accent: '#FF6B35', max_width: 1200 }) as unknown as Rec;
    designPath = r['design_path'] as string;
  });

  it('merges one setting and leaves the rest alone', () => {
    const r = customizeReport({ design_path: designPath, changes: { accent: '#0EA5E9' } }) as unknown as Rec;
    expect(r['changed']).toEqual(['~accent']);
    const s = r['settings'] as Rec;
    expect(s['accent']).toBe('#0EA5E9');
    expect(s['max_width']).toBe(1200);      // untouched
    expect(s['layout']).toBe('flow');
  });

  it('null deletes a setting, back to the engine default', () => {
    const r = customizeReport({ design_path: designPath, changes: { max_width: null } }) as unknown as Rec;
    expect(r['changed']).toEqual(['-max_width']);
    expect('max_width' in (r['settings'] as Rec)).toBe(false);
  });

  it('dry_run reports the diff without writing', () => {
    customizeReport({ design_path: designPath, changes: { accent: '#111111' }, dry_run: true });
    const after = read(designPath);
    expect(((after['report'] as Rec)['accent'])).toBe('#FF6B35');
  });

  it('a no-op patch says so rather than churning the file', () => {
    const r = customizeReport({ design_path: designPath, changes: { accent: '#FF6B35' } }) as unknown as Rec;
    expect(r['changed']).toEqual([]);
    expect(String(r['note'])).toMatch(/already matched/);
  });

  it('refuses a design of the wrong kind, and names the right tool', () => {
    createDesign({ project_path: projectDir, name: 'a-poster', type: 'poster', width: 1080, height: 1350 });
    const r = customizeReport({ design_path: path.join(projectDir, 'designs', 'a-poster.design.yaml'), changes: { accent: '#000' } }) as unknown as Rec;
    expect(r['success']).toBe(false);
    expect(String(r['hint'])).toMatch(/patch_spec/);
  });
});

describe('presentation {op:"customize"} — re-shape a deck without rebuilding it', () => {
  let deckPath: string;

  beforeEach(() => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'cz', canvas: '1080x1080' });
    const p = createPresentation({
      project_path: projectDir, name: `deck-${Math.random().toString(36).slice(2, 7)}`,
      pages: [{ id: 'slide_1', label: 'Cover' }], width: 1920, height: 1080, theme: 'dark',
    }) as unknown as Rec;
    deckPath = p['design_path'] as string;
    addLayers({ design_path: deckPath, page_id: 'slide_1', layers_shorthand: [SECTIONS('s1', 1920, 1080)] });
  });

  it('merges presenter settings', () => {
    const r = customizePresentation({ design_path: deckPath, changes: { auto_advance: 5000, show_controls: false } }) as unknown as Rec;
    expect(r['changed']).toEqual(['~auto_advance', '~show_controls']);
    expect((r['settings'] as Rec)['keyboard']).toBe(true);   // untouched
  });

  // The capability the spec round-trip unlocks: a preset is REBUILT for the new
  // page shape, not shrunk inside it.
  it('re-shapes 1920×1080 → 1080×1350 by re-expanding presets from their spec', () => {
    const r = customizePresentation({ design_path: deckPath, changes: { width: 1080, height: 1350 } }) as unknown as Rec;
    expect(r['canvas']).toBe('1080×1350');
    expect((r['reflowed'] as Rec)['presets_reexpanded']).toBe(1);

    const after = read(deckPath);
    const doc = after['document'] as Rec;
    expect(doc['width']).toBe(1080);
    expect(doc['height']).toBe(1350);
  });

  it('the re-laid-out slide fits the new canvas — nothing renders off the edge', () => {
    customizePresentation({ design_path: deckPath, changes: { width: 1080, height: 1350 } });
    const after = read(deckPath);
    const page = (after['pages'] as Rec[])[0];
    for (const l of page['layers'] as Rec[]) expect(bottom(l)).toBeLessThanOrEqual(1350 + 1);
  });

  it('re-expands rather than stretches — the layout is rebuilt at the new width', () => {
    const before = read(deckPath);
    const wideGroup = ((before['pages'] as Rec[])[0]['layers'] as Rec[])[0];
    const wideTitle = ((wideGroup['layers'] as Rec[]).find(l => String(l['id']).endsWith('_title')) as Rec | undefined);
    customizePresentation({ design_path: deckPath, changes: { width: 1080, height: 1350 } });
    const after = read(deckPath);
    const tallGroup = ((after['pages'] as Rec[])[0]['layers'] as Rec[])[0];
    const tallTitle = ((tallGroup['layers'] as Rec[]).find(l => String(l['id']).endsWith('_title')) as Rec | undefined);
    expect(wideTitle).toBeDefined();
    expect(tallTitle).toBeDefined();
    // A pure scale would multiply the title box by 1080/1920 = 0.5625. A real
    // re-expansion sizes it from the NEW box instead, so it is wider than that.
    expect(Number(tallTitle!['width'])).toBeGreaterThan(Number(wideTitle!['width']) * 0.6);
    // And it still carries its spec, so the loop stays closed after a reshape.
    expect(tallGroup['_spec']).toBeDefined();
  });

  it('keeps the canvas and settings in one call', () => {
    const r = customizePresentation({ design_path: deckPath, changes: { theme: 'light', width: 1080, height: 1080 } }) as unknown as Rec;
    expect(r['changed']).toContain('+theme');
    expect(r['canvas']).toBe('1080×1080');
  });

  it('dry_run announces the reflow without performing it', () => {
    const r = customizePresentation({ design_path: deckPath, changes: { width: 1080, height: 1350 }, dry_run: true }) as unknown as Rec;
    expect(r['would_reflow']).toBe(true);
    expect((read(deckPath)['document'] as Rec)['width']).toBe(1920);
  });
});

describe('manage_design {op:"resize"} — the twin for create_design\'s shape', () => {
  let posterPath: string;

  beforeEach(() => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'cz', canvas: '1080x1080' });
    const d = createDesign({ project_path: projectDir, name: `p-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1080 }) as unknown as Rec;
    posterPath = d['path'] as string;
    addLayers({ design_path: posterPath, layers_shorthand: [SECTIONS('s1', 1080, 1080)] });
  });

  it('re-lays a square poster out as a portrait one', () => {
    const r = resizeDesign({ design_path: posterPath, height: 1350 }) as unknown as Rec;
    expect(r['canvas']).toBe('1080×1350');
    expect((r['reflowed'] as Rec)['presets_reexpanded']).toBe(1);
    const doc = read(posterPath)['document'] as Rec;
    expect(doc['width']).toBe(1080);
    expect(doc['height']).toBe(1350);
  });

  it('keeps the dimension you leave out', () => {
    resizeDesign({ design_path: posterPath, width: 1440 });
    const doc = read(posterPath)['document'] as Rec;
    expect(doc['width']).toBe(1440);
    expect(doc['height']).toBe(1080);
  });

  it('is a no-op at the same size', () => {
    const r = resizeDesign({ design_path: posterPath, width: 1080, height: 1080 }) as unknown as Rec;
    expect(r['changed']).toBe(false);
    expect(String(r['note'])).toMatch(/Already that size/);
  });

  it('refuses an absurd canvas rather than producing one', () => {
    const r = resizeDesign({ design_path: posterPath, width: 10, height: 10 }) as unknown as Rec;
    expect(r['success']).toBe(false);
    expect(String(r['hint'])).toMatch(/80 and 20000/);
  });

  it('says plainly when nothing carried a spec, so scaling was all it could do', () => {
    const d = createDesign({ project_path: projectDir, name: `hand-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1080 }) as unknown as Rec;
    const p = d['path'] as string;
    addLayers({ design_path: p, layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#101010' } },
      { id: 'h', type: 'text', z: 1, x: 80, y: 100, width: 900, height: 120, content: { type: 'plain', value: 'Hand placed' }, style: { font_size: 64, color: '#FAFAFA' } },
    ] as never });
    const r = resizeDesign({ design_path: p, height: 1350 }) as unknown as Rec;
    expect((r['reflowed'] as Rec)['presets_reexpanded']).toBe(0);
    expect(String(r['note'])).toMatch(/SCALED rather than re-laid out/);
  });
});
