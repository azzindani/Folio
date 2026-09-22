import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { groundLayers, components, layoutNotes, reviewLayout } from './layout-review';

const rect = (id: string, x: number, y: number, w: number, h: number, color = '#222222', z = 0): Layer =>
  ({ id, type: 'rect', x, y, width: w, height: h, z, fill: { type: 'solid', color } }) as unknown as Layer;
const text = (id: string, x: number, y: number, w: number, h: number, value: string, size = 64): Layer =>
  ({ id, type: 'text', x, y, width: w, height: h, z: 5, content: { type: 'plain', value }, style: { font_family: 'Inter', font_size: size, color: '#111111' } }) as unknown as Layer;
const group = (id: string, x: number, y: number, w: number, h: number, layers: Layer[]): Layer =>
  ({ id, type: 'group', x, y, width: w, height: h, z: 1, layers }) as unknown as Layer;
const poster = (layers: Layer[], W = 1920, H = 1080): DesignSpec =>
  ({ meta: { name: 't', version: '1' }, document: { width: W, height: H, unit: 'px' }, layers }) as unknown as DesignSpec;

describe('groundLayers', () => {
  it('takes the full-bleed fills at the bottom and stops at content', () => {
    const bg = rect('bg', 0, 0, 1920, 1080, '#f4efe6');
    const g = groundLayers([text('t', 100, 100, 600, 100, 'Hi'), bg], 1920, 1080);
    expect(g.map(l => l.id)).toEqual(['bg']);
  });

  it('looks inside a full-bleed preset group for its backdrop', () => {
    const inner = [rect('p_bg', 0, 0, 1920, 1080, '#0b1020'), text('p_t', 100, 100, 600, 100, 'Hi')];
    const g = groundLayers([group('p', 0, 0, 1920, 1080, inner)], 1920, 1080);
    expect(g).toHaveLength(1);
    expect((g[0] as unknown as { layers: Layer[] }).layers.map(l => l.id)).toEqual(['p_bg']);
  });

  it('a card is not ground', () => {
    expect(groundLayers([rect('card', 100, 100, 400, 300)], 1920, 1080)).toEqual([]);
  });
});

describe('components', () => {
  it('lists the parts on the canvas, largest first, inside containers', () => {
    const inner = [rect('p_bg', 0, 0, 1920, 1080), rect('card', 100, 100, 800, 600), text('cap', 100, 750, 400, 60, 'x')];
    const cs = components([group('p', 0, 0, 1920, 1080, inner), rect('far', 5000, 0, 100, 100)], 1920, 1080, new Set());
    expect(cs.map(c => c.id)).toEqual(['card', 'cap']);          // full-bleed + off-canvas left out
    expect(cs[0]?.share.area).toBeCloseTo(0.23, 2);
  });
});

describe('layoutNotes', () => {
  const base = {
    canvas: '1920×1080', ink: 0.1, occupied: 0.3, content_box: { x: 80, y: 80, width: 700, height: 900, margins: { left: 80, right: 1140, top: 80, bottom: 100 } },
    empty: [{ x: 900, y: 0, width: 1020, height: 1080, share: 0.53 }], thirds: [],
    balance: { centroid: { x: 0.25, y: 0.5 }, offset: { x: -0.25, y: 0 }, left_right: [90, 10] as [number, number], top_bottom: [50, 50] as [number, number] },
    components: [
      { id: 'panel', type: 'rect', box: { x: 0, y: 0, width: 1500, height: 900 }, share: { w: 0.78, h: 0.83, area: 0.65 } },
      { id: 'hero', type: 'image', box: { x: 0, y: 0, width: 1400, height: 800 }, share: { w: 0.73, h: 0.74, area: 0.54 } },
    ],
    type_scale: null,
  };
  it('states the facts a viewer notices, and only those', () => {
    const n = layoutNotes(base);
    expect(n.some(s => s.startsWith('53% of the canvas is one empty area'))).toBe(true);
    expect(n.some(s => s.includes('25% left of centre'))).toBe(true);
    expect(n.some(s => s.includes('"hero"'))).toBe(true);
    expect(n.some(s => s.includes('"panel"'))).toBe(false);        // a backdrop panel is not an oversized part
    expect(n.some(s => s.startsWith('Content spans 36% of the width'))).toBe(true);
  });
});

describe('reviewLayout (rendered)', () => {
  it('sees a left-heavy poster with an empty right side', () => {
    const spec = poster([
      rect('bg', 0, 0, 1920, 1080, '#f4efe6'),
      text('title', 120, 200, 560, 300, 'Words in. Design out.', 96),
      rect('bar', 120, 560, 480, 24, '#d9480f'),
    ]);
    const [p] = reviewLayout(spec, '/tmp');
    expect(p?.canvas).toBe('1920×1080');
    expect(p?.balance?.offset.x ?? 0).toBeLessThan(-0.15);
    expect((p?.empty[0]?.share ?? 0)).toBeGreaterThan(0.3);
    expect((p?.empty[0]?.x ?? 0)).toBeGreaterThanOrEqual(600);
    expect(p?.type_scale?.max_px).toBe(96);
    expect(p?.notes.some(s => s.includes('empty area'))).toBe(true);
  }, 30_000);

  it('measures each page of a deck, or just the one asked for', () => {
    const spec = { ...poster([]), pages: [
      { id: 'a', layers: [rect('bg', 0, 0, 1920, 1080, '#ffffff'), rect('box', 0, 0, 960, 1080)] },
      { id: 'b', layers: [rect('bg', 0, 0, 1920, 1080, '#ffffff'), rect('box', 960, 0, 960, 1080)] },
    ] } as unknown as DesignSpec;
    const all = reviewLayout(spec, '/tmp');
    expect(all.map(p => p.page)).toEqual(['a', 'b']);
    expect(all[0]?.balance?.offset.x ?? 0).toBeLessThan(0);
    expect(all[1]?.balance?.offset.x ?? 0).toBeGreaterThan(0);
    expect(reviewLayout(spec, '/tmp', 'b').map(p => p.page)).toEqual(['b']);
  }, 30_000);
});
