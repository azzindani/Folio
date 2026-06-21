import { describe, it, expect } from 'vitest';
import { scatterLayers, doodleLayer, buildDoodles, DOODLE_KINDS } from './shorthand-doodles';

const BOX = { X: 0, Y: 0, W: 1000, H: 1400 };

describe('scatterLayers', () => {
  it('is deterministic for a given seed', () => {
    const opts = { count: 12, colors: ['#E6483D', '#2E6FB7'], idp: 's', z0: 0, seed: 42, sizeMin: 20, sizeMax: 40, sw: 3 };
    const a = scatterLayers(BOX, opts);
    const b = scatterLayers(BOX, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('places roughly the requested count', () => {
    const out = scatterLayers(BOX, { count: 15, colors: ['#000'], idp: 's', z0: 0, seed: 7, sizeMin: 18, sizeMax: 36, sw: 3 });
    expect(out.length).toBeGreaterThan(8);
    expect(out.length).toBeLessThanOrEqual(15);
  });

  it('keeps doodles out of keep-out regions', () => {
    const ko = [{ x: 100, y: 100, w: 800, h: 1000 }]; // covers most of the canvas
    const out = scatterLayers(BOX, { count: 20, colors: ['#000'], idp: 's', z0: 0, seed: 3, sizeMin: 16, sizeMax: 30, sw: 3, keepOut: ko });
    for (const l of out) {
      const o = l as unknown as { x: number; y: number; width: number; height: number };
      const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
      // The scatterer pads keep-out by size*0.6+8, so a center is never inside the
      // bare region — that is the guarantee we assert.
      const inside = cx > 100 && cx < 900 && cy > 100 && cy < 1100;
      expect(inside).toBe(false);
    }
  });

  it('doodleLayer emits a path for glyphs and an ellipse for ring/dot', () => {
    expect((doodleLayer('spark', 'x', 0, 50, 50, 40, '#E6483D', 0, 3) as { type: string }).type).toBe('path');
    expect((doodleLayer('ring', 'x', 0, 50, 50, 40, '#E6483D', 0, 3) as { type: string }).type).toBe('ellipse');
    expect((doodleLayer('dot', 'x', 0, 50, 50, 40, '#E6483D', 0, 3) as { type: string }).type).toBe('ellipse');
  });

  it('every kind produces a renderable layer', () => {
    for (const k of DOODLE_KINDS) {
      const l = doodleLayer(k, k, 0, 100, 100, 40, '#222', 10, 3) as unknown as { type: string; d?: string };
      expect(l.type === 'path' || l.type === 'ellipse').toBe(true);
      if (l.type === 'path') expect((l.d ?? '').length).toBeGreaterThan(0);
    }
  });

  it('buildDoodles returns a group of scattered marks', () => {
    const g = buildDoodles({ type: 'doodles', pos: [0, 0, 1080, 1080], density: 'dense' } as never, 'dd', 0) as unknown as { type: string; layers: unknown[] };
    expect(g.type).toBe('group');
    expect(g.layers.length).toBeGreaterThan(10);
  });
});
