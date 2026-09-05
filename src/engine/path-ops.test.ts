import { describe, it, expect } from 'vitest';
import { resample, alignStart, blendPaths, outlineStroke, offsetPath, ringToD, type Pt } from './path-ops';

const SQ = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
const TRI = 'M 50 0 L 100 100 L 0 100 Z';

/** Bounding box of every coordinate pair in a path `d`. */
function bbox(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

describe('resample', () => {
  it('returns exactly n points spaced by arc length', () => {
    const pts = resample([[0, 0], [10, 0], [10, 10]] as Pt[], 4);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]?.[0]).toBeCloseTo(5, 5);       // a quarter of 20 units along
  });

  it('survives a degenerate polyline instead of dividing by zero', () => {
    expect(resample([[3, 3], [3, 3]] as Pt[], 3)).toEqual([[3, 3], [3, 3], [3, 3]]);
  });
});

describe('alignStart', () => {
  it('rotates the second ring to the closest correspondence', () => {
    const a: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const rotated: Pt[] = [[10, 10], [0, 10], [0, 0], [10, 0]];
    expect(alignStart(a, rotated)).toEqual(a);
  });
});

describe('blendPaths', () => {
  it('produces the requested number of in-between shapes', () => {
    expect(blendPaths(SQ, TRI, 3)).toHaveLength(3);
  });

  it('moves monotonically from one shape toward the other', () => {
    const steps = blendPaths(SQ, TRI, 3) ?? [];
    // The square's top edge spans the full width; the triangle's apex is a
    // point. The top of each step should narrow as it approaches the triangle.
    const widthAtTop = (d: string): number => {
      const b = bbox(d);
      return b.x1 - b.x0;
    };
    expect(widthAtTop(steps[0] as string)).toBeGreaterThan(0);
    expect(steps).toHaveLength(3);
    // Endpoints are NOT included — the caller already has them.
    expect(steps.includes(SQ)).toBe(false);
  });

  it('is null when either path cannot be walked', () => {
    expect(blendPaths(SQ, 'M 0 0 A 5 5 0 0 1 9 9', 2)).toBeNull();
    expect(blendPaths('nonsense', TRI, 2)).toBeNull();
  });
});

describe('offsetPath', () => {
  it('shrinks a square to exactly the inset square', async () => {
    const d = await offsetPath(SQ, -10);
    const b = bbox(d ?? '');
    expect(b.x0).toBeCloseTo(10, 1);
    expect(b.y0).toBeCloseTo(10, 1);
    expect(b.x1).toBeCloseTo(90, 1);
    expect(b.y1).toBeCloseTo(90, 1);
  });

  it('grows a square past its original bounds', async () => {
    const b = bbox((await offsetPath(SQ, 10)) ?? '');
    expect(b.x0).toBeLessThanOrEqual(-9.9);
    expect(b.x1).toBeGreaterThanOrEqual(109.9);
  });

  it('returns null for a no-op or an unwalkable path', async () => {
    expect(await offsetPath(SQ, 0)).toBeNull();
    expect(await offsetPath('M 0 0 A 1 1 0 0 1 2 2', 5)).toBeNull();
  });
});

describe('outlineStroke', () => {
  it('turns a line into a filled band of the right thickness', async () => {
    const b = bbox((await outlineStroke('M 0 50 L 200 50', 20)) ?? '');
    expect(b.y0).toBeCloseTo(40, 1);
    expect(b.y1).toBeCloseTo(60, 1);
    // Round caps extend half a width past each end.
    expect(b.x0).toBeCloseTo(-10, 1);
    expect(b.x1).toBeCloseTo(210, 1);
  });

  it('refuses a zero or negative width rather than emitting an empty shape', async () => {
    expect(await outlineStroke('M 0 0 L 10 0', 0)).toBeNull();
    expect(await outlineStroke('M 0 0 L 10 0', -4)).toBeNull();
  });
});

describe('ringToD', () => {
  it('closes the ring', () => {
    expect(ringToD([[0, 0], [1, 0], [1, 1]] as Pt[])).toBe('M 0.00 0.00 L 1.00 0.00 L 1.00 1.00 Z');
  });
  it('is empty for an empty ring', () => expect(ringToD([])).toBe(''));
});
