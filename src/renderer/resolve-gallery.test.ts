// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, GallerySpec, Layer } from '../schema/types';
import { galleryCells, resolveGalleries } from './resolve-gallery';
import { resolveSpec } from './resolve-source';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { specAt } from '../export/gif-frames';
import { collectFindings } from '../mcp/engine/diagnose-collect';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const PEOPLE = [{ name: 'Ada', role: 'Compilers' }, { name: 'Grace', role: 'Languages' }, { name: 'Edsger', role: 'Proofs' },
  { name: 'Barbara', role: 'Abstraction' }, { name: 'Alan', role: 'Machines' }, { name: 'Frances', role: 'Optimisers' }];
const template: Layer[] = [
  L({ id: 'card', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: '#1B998B', formulas: { width: '=CellW', height: '=CellH' } }),
  L({ id: 'name', type: 'text', z: 1, x: 24, y: 24, width: 240, height: 48, content: { type: 'plain', value: '{{name}}' },
    style: { font_size: 36, color: '#FFFFFF' }, formulas: { 'style.font_size': '=Index === 0 ? 44 : 36' } }),
];
const gallery = (g: Partial<GallerySpec> = {}): Layer =>
  L({ id: 'people', type: 'group', z: 1, x: 80, y: 400, width: 920, height: 600, layers: [], gallery: { items: PEOPLE, template, columns: 3, gap: 20, ...g } });
const design = (layers: Layer[], names?: Record<string, unknown>): DesignSpec =>
  ({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 }, ...(names ? { names } : {}), layers } as unknown as DesignSpec);
const kids = (l: Layer | undefined): Layer[] => (l as Layer & { layers?: Layer[] } | undefined)?.layers ?? [];

describe('galleries', () => {
  it('shares the box out between the cells, and defaults to one row on a wide box, one column on a tall one', () => {
    const cells = galleryCells({ items: 6, template: [], columns: 3, gap: 20 }, { x: 80, y: 400, width: 920, height: 600 }, 6);
    expect(cells[4]).toEqual({ x: 80 + (880 / 3 + 20), y: 400 + 290 + 20, width: 880 / 3, height: 290, row: 1, col: 1 });
    expect(galleryCells({ items: 3, template: [] }, { x: 0, y: 0, width: 900, height: 300 }, 3).map(c => c.col)).toEqual([0, 1, 2]);
    expect(galleryCells({ items: 3, template: [], gap: [0, 30], cell: { height: 100 } }, { x: 0, y: 0, width: 300, height: 900 }, 3).map(c => c.y)).toEqual([0, 130, 260]);
  });

  it("fills {{i}} from a row's own i before the count (Opus 5.5 promo: icon names came out as 1, 2, 3)", () => {
    const icons = L({ id: 'at', type: 'group', z: 1, x: 0, y: 0, width: 300, height: 100, layers: [],
      gallery: { items: [{ i: 'cloud' }, { i: 'terminal' }], columns: 2, gap: 0, template: [L({ id: 'ico', type: 'icon', z: 0, x: 0, y: 0, width: 40, height: 40, name: '{{i}}' })] } });
    const [g] = resolveGalleries([icons], { names: {}, W: 1080, H: 1350 });
    expect(kids(g).map(c => (kids(c)[0] as unknown as { name: string }).name)).toEqual(['cloud', 'terminal']);
    const [counted] = resolveGalleries([gallery({ template: [L({ id: 'n', type: 'text', z: 0, x: 0, y: 0, width: 50, height: 30, content: { type: 'plain', value: '{{i}}' } })] })], { names: {}, W: 1080, H: 1350 });
    expect((kids(kids(counted)[2])[0] as unknown as { content: { value: string } }).content.value).toBe('3');
  });

  it('lays each row out as an ordinary group, filled from its row, its formulas reading Item and Index', () => {
    const [g] = resolveGalleries([gallery()], { names: {}, W: 1080, H: 1350 });
    expect(g).not.toHaveProperty('gallery');
    expect(kids(g).map(c => c.id)).toEqual(['people_1', 'people_2', 'people_3', 'people_4', 'people_5', 'people_6']);
    const [card, name] = kids(kids(g)[4]);
    expect(card).toMatchObject({ id: 'people_5_card', x: 80 + 880 / 3 + 20, y: 710, width: 880 / 3, height: 290 });
    expect(card).not.toHaveProperty('formulas');
    expect(name).toMatchObject({ id: 'people_5_name', content: { value: 'Alan' }, style: { font_size: 36 } });
    expect(kids(kids(g)[0])[1]).toMatchObject({ style: { font_size: 44 } });
    const plain = [L({ id: 'g', type: 'group', z: 0, layers: [L({ id: 'r', type: 'rect', z: 0 })] })];
    expect(resolveGalleries(plain, { names: {}, W: 1, H: 1 })).toBe(plain);
  });

  it('is drawn, framed and diagnosed as its items — rows may come from a name', () => {
    const spec = design([gallery({ items: '=People' })], { People: PEOPLE });
    const svg = renderToSVGString(spec);
    for (const p of PEOPLE) expect(svg).toContain(`>${p.name}<`);
    expect(svg).toContain('data-layer-id="people_6_name"');
    expect(kids(specAt(spec, 0, 0).layers?.[0])).toHaveLength(6);
    expect(kids(resolveSpec(spec).layers?.[0])).toHaveLength(6);
    // The second row's names sit below the canvas: judged where they are drawn, like any group's words.
    const tooLow = design([{ ...gallery(), y: 1000 } as Layer]);
    const off = collectFindings(tooLow, '/dev/null').filter(f => f.code === 'off_canvas').map(f => f.layer_id);
    expect(off).toEqual(['people', 'people_4_name', 'people_5_name', 'people_6_name']);
  });

  it('staggers a template\'s motion by Index in the exported frames', () => {
    const fade = L({ id: 'dot', type: 'rect', z: 0, x: 0, y: 0, width: 40, height: 40, fill: '#E4572E',
      animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, origin: 'offset' } },
      formulas: { 'animation.playback.delay': '=Index * 1000' } });
    const spec = design([gallery({ items: 3, template: [fade] })]);
    const at = (t: number): unknown[] => kids(specAt(spec, 0, t).layers?.[0]).map(c => (kids(c)[0] as { opacity?: number }).opacity ?? 1);
    expect(at(1500)).toEqual([1, 1, 0]);
  });

  it('evaluates template formulas in the template\'s frame, then moves them onto the cell (a timetable\'s acts)', () => {
    const acts = L({ id: 'acts', type: 'group', z: 1, x: 200, y: 600, width: 900, height: 900, layers: [], gallery: {
      items: [{ col: 0, h: 0 }, { col: 2, h: 1.5 }], columns: 1, cell: { width: 280, height: 0 },
      template: [L({ id: 'card', type: 'rect', z: 0, x: 0, y: 0, width: 280, height: 100, formulas: { x: '=Item.col * 300', y: '=Item.h * 134' } })] } });
    const cards = kids(resolveGalleries([acts], { names: {}, W: 1600, H: 2000 })[0]).map(c => kids(c)[0]);
    expect(cards.map(c => [c?.x, c?.y])).toEqual([[200, 600], [800, 600 + 201]]);
  });

  it('fills a nested gallery\'s template from ITS rows, not the cell around it (close-out C3, found live)', () => {
    const inner = L({ id: 'chips', type: 'group', z: 1, x: 0, y: 60, width: 600, height: 40, layers: [], gallery: {
      items: [{ tag: 'jazz' }, { tag: 'folk' }], template: [L({ id: 'chip', type: 'text', z: 0, x: 0, y: 0, width: 200, height: 40, content: { type: 'plain', value: '{{i}}. {{tag}}' } })] } });
    const outer = L({ id: 'rows', type: 'group', z: 1, x: 0, y: 0, width: 600, height: 300, layers: [], gallery: { items: [{ t: 'A' }, { t: 'B' }], columns: 1,
      template: [L({ id: 'title', type: 'text', z: 1, x: 0, y: 0, width: 300, height: 40, content: { type: 'plain', value: '{{i}} {{t}}' } }), inner] } });
    const text = (id: string): string | undefined => {
      const find = (ls: Layer[]): Layer | undefined => { for (const l of ls) { if (l.id === id) return l; const k = find(kids(l)); if (k) return k; } return undefined; };
      return (find(resolveGalleries([outer], { names: {}, W: 1080, H: 1080 })) as { content?: { value?: string } } | undefined)?.content?.value;
    };
    expect(text('rows_2_title')).toBe('2 B');
    expect(text('rows_2_chips_1_chip')).toBe('1. jazz');
    expect(text('rows_2_chips_2_chip')).toBe('2. folk');
  });

  it('names a list it cannot read', () => {
    const errs = collectFindings(design([gallery({ items: '=Peeple' })]), '/dev/null').filter(f => f.code === 'formula_error');
    expect(errs.map(f => f.message)).toEqual([expect.stringContaining('"people" gallery.items = =Peeple fails')]);
  });
});
