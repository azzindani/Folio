import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { translateSubtree, scaleAbout, drawnBox, findTargets } from './layer-transform';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const rect = (id: string, x: number, y: number, w = 100, h = 50): Layer => L({ id, type: 'rect', x, y, width: w, height: h });

describe('translateSubtree', () => {
  it('moves a group AND what it draws — children, lines, paths, polygons', () => {
    const g = L({ id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500, layers: [
      rect('a', 10, 20),
      L({ id: 'ln', type: 'line', x1: 0, y1: 0, x2: 100, y2: 50 }),
      L({ id: 'p', type: 'path', d: 'M10 10 L110 10 l0 40 Z' }),
      L({ id: 'pg', type: 'polygon', points: '0,0 50,0 25,40' }),
      L({ id: 'pos', type: 'rect', pos: [5, 5, 10, 10] }),
    ] });
    translateSubtree(g, 100, -10);
    const k = (g as unknown as { layers: Record<string, unknown>[] }).layers;
    expect([k[0]?.['x'], k[0]?.['y']]).toEqual([110, 10]);
    expect([k[1]?.['x1'], k[1]?.['y1'], k[1]?.['x2'], k[1]?.['y2']]).toEqual([100, -10, 200, 40]);
    expect(k[2]?.['d']).toBe('M110 0L210 0l0 40Z');                 // relative segment untouched
    expect(k[3]?.['points']).toBe('100,-10 150,-10 125,30');
    expect(k[4]?.['pos']).toEqual([105, -5, 10, 10]);
    expect([(g as unknown as { x: number }).x, (g as unknown as { y: number }).y]).toEqual([100, -10]);
  });
});

describe('scaleAbout', () => {
  it('scales boxes and type about a point', () => {
    const t = L({ id: 't', type: 'text', x: 100, y: 100, width: 200, height: 100, style: { font_size: 40 } });
    scaleAbout(t, 2, 100, 100);
    const o = t as unknown as Record<string, unknown>;
    expect([o['x'], o['y'], o['width'], o['height']]).toEqual([100, 100, 400, 200]);
    expect((o['style'] as { font_size: number }).font_size).toBe(80);
  });

  it('turns pos into a box first, so it scales', () => {
    const r = L({ id: 'r', type: 'rect', pos: [0, 0, 100, 100] });
    scaleAbout(r, 0.5, 0, 0);
    expect((r as unknown as { width: number }).width).toBe(50);
  });
});

describe('drawnBox + findTargets', () => {
  it('a group is where its children draw, not its declared box', () => {
    const g = L({ id: 'g', type: 'group', x: 0, y: 0, width: 1920, height: 1080, layers: [rect('a', 100, 100), rect('b', 400, 300)] });
    expect(drawnBox(g)).toEqual({ x: 100, y: 100, w: 400, h: 250 });
  });

  it('finds at any depth, names locked and missing ids, drops a target inside a target', () => {
    const tree = [
      L({ id: 'scene', type: 'group', locked: true, layers: [rect('inLocked', 0, 0)] }),
      L({ id: 'card', type: 'group', layers: [rect('title', 0, 0)] }),
    ];
    const r = findTargets(tree, ['inLocked', 'card', 'title', 'nope']);
    expect(r.targets.map(l => l.id)).toEqual(['card']);          // title moves with card, not twice
    expect(r.locked).toEqual(['inLocked (in "scene")']);
    expect(r.unresolved).toEqual(['nope']);
  });
});
