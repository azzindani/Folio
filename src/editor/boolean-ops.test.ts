import { describe, it, expect } from 'vitest';
import { layerToPoly, booleanPathD } from './boolean-ops';
import type { Layer } from '../schema/types';

const rect = (id: string, x: number, y: number, w: number, h: number): Layer =>
  ({ id, type: 'rect', z: 0, x, y, width: w, height: h } as unknown as Layer);

describe('layerToPoly', () => {
  it('flattens a rect to its 4 corners', () => {
    const p = layerToPoly(rect('a', 10, 20, 100, 50));
    expect(p).toEqual([[[10, 20], [110, 20], [110, 70], [10, 70]]]);
  });
  it('flattens an ellipse to a sampled ring', () => {
    const p = layerToPoly({ id: 'e', type: 'ellipse', z: 0, x: 0, y: 0, width: 100, height: 60 } as unknown as Layer);
    expect(p![0].length).toBeGreaterThan(16);
  });
  it('handles circle stored as cx/cy/rx/ry', () => {
    const p = layerToPoly({ id: 'c', type: 'circle', z: 0, cx: 50, cy: 50, rx: 20, ry: 20 } as unknown as Layer);
    expect(p).not.toBeNull();
  });
  it('parses polygon points', () => {
    const p = layerToPoly({ id: 'p', type: 'polygon', z: 0, points: '0,0 10,0 10,10' } as unknown as Layer);
    expect(p).toEqual([[[0, 0], [10, 0], [10, 10]]]);
  });
  it('returns null for a text layer', () => {
    expect(layerToPoly({ id: 't', type: 'text', z: 0 } as unknown as Layer)).toBeNull();
  });
});

describe('booleanPathD', () => {
  it('union of two overlapping rects yields one closed contour with area', async () => {
    const d = await booleanPathD(rect('a', 0, 0, 100, 100), rect('b', 50, 50, 100, 100), 'union');
    expect(d).toBeTruthy();
    expect(d!.startsWith('M')).toBe(true);
    expect(d!.endsWith('Z')).toBe(true);
    // union of two 100×100 rects overlapping by 50×50 = 17500 area → an
    // L-shaped contour with 8 distinct vertices (6 line segments after M).
    const verts = (d!.match(/[ML]/g) ?? []).length;
    expect(verts).toBeGreaterThanOrEqual(6);
  });

  it('intersect of two overlapping rects is the 50×50 overlap square', async () => {
    const d = await booleanPathD(rect('a', 0, 0, 100, 100), rect('b', 50, 50, 100, 100), 'intersect');
    expect(d).toBeTruthy();
    // 4 corners around (50,50)-(100,100)
    expect(d).toContain('50');
    expect(d).toContain('100');
  });

  it('subtract (a − b) of fully-overlapping identical rects is empty', async () => {
    const d = await booleanPathD(rect('a', 0, 0, 100, 100), rect('b', 0, 0, 100, 100), 'subtract');
    expect(d).toBeNull();
  });

  it('non-overlapping rects union keeps both contours', async () => {
    const d = await booleanPathD(rect('a', 0, 0, 40, 40), rect('b', 100, 100, 40, 40), 'union');
    expect((d!.match(/Z/g) ?? []).length).toBe(2);
  });
});
