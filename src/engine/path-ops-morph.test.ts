import { describe, it, expect } from 'vitest';
import { morphPair, morphPathAt, blendPaths } from './path-ops';

const square = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
const diamond = 'M 50 0 L 100 50 L 50 100 L 0 50 Z';
/** The [x, y] points of a ringToD outline. */
const points = (d: string): Array<[number, number]> => {
  const n = [...d.matchAll(/-?\d+\.\d+/g)].map(m => Number(m[0]));
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i] as number, n[i + 1] as number]);
  return out;
};

describe('morph', () => {
  const pair = morphPair(square, diamond, 16);

  it('starts on the first outline and ends on the second, with one point count throughout', () => {
    expect(pair).not.toBeNull();
    if (!pair) return;
    const start = points(morphPathAt(pair, 0)), end = points(morphPathAt(pair, 1));
    expect(start).toHaveLength(16);
    expect(end).toHaveLength(16);
    for (const [x, y] of start) expect(x === 0 || x === 100 || y === 0 || y === 100).toBe(true);
    for (const [x, y] of end) expect(Math.abs(x - 50) + Math.abs(y - 50)).toBeCloseTo(50, 1);
  });

  it('is the pointwise average halfway through', () => {
    if (!pair) return;
    const a = points(morphPathAt(pair, 0)), b = points(morphPathAt(pair, 1)), mid = points(morphPathAt(pair, 0.5));
    mid.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(((a[i]?.[0] ?? 0) + (b[i]?.[0] ?? 0)) / 2, 1);
      expect(y).toBeCloseTo(((a[i]?.[1] ?? 0) + (b[i]?.[1] ?? 0)) / 2, 1);
    });
  });

  it('refuses an outline it cannot flatten, the way motion paths do', () => {
    expect(morphPair('M 0 0 A 10 10 0 0 1 20 0', square)).toBeNull();
  });

  it('keeps blend returning only the in-between shapes', () => {
    expect(blendPaths(square, diamond, 3)).toHaveLength(3);
  });
});
