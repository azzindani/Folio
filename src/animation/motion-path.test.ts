import { describe, it, expect } from 'vitest';
import { flattenPath, samplePath } from './motion-path';

const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) <= tol;

describe('flattenPath', () => {
  it('walks a straight line', () => {
    const pts = flattenPath('M 0 0 L 100 0');
    expect(pts).not.toBeNull();
    expect(pts?.[0]).toEqual({ x: 0, y: 0 });
    expect(pts?.[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('handles relative commands against the running point', () => {
    const pts = flattenPath('M 10 10 l 20 0 l 0 20');
    expect(pts?.[pts.length - 1]).toEqual({ x: 30, y: 30 });
  });

  it('handles H and V', () => {
    const pts = flattenPath('M 0 0 H 50 V 25');
    expect(pts?.[pts.length - 1]).toEqual({ x: 50, y: 25 });
  });

  it('closes a subpath on Z', () => {
    const pts = flattenPath('M 5 5 L 50 5 L 50 50 Z');
    expect(pts?.[pts.length - 1]).toEqual({ x: 5, y: 5 });
  });

  // Refusing beats approximating: the browser draws the real arc, and a
  // flipbook that guessed would disagree with it frame for frame.
  it('refuses an elliptical arc rather than approximating it', () => {
    expect(flattenPath('M 0 0 A 50 50 0 0 1 100 0')).toBeNull();
    expect(flattenPath('M 0 0 a 50 50 0 0 1 100 0')).toBeNull();
  });

  it('refuses junk and a path with nowhere to go', () => {
    expect(flattenPath('')).toBeNull();
    expect(flattenPath('L 10 10')).toBeNull();       // no initial move
    expect(flattenPath('M 5 5')).toBeNull();          // single point
  });
});

describe('samplePath', () => {
  it('walks a line by ARC LENGTH, so halfway is halfway', () => {
    const sp = samplePath('M 0 0 L 100 0');
    expect(sp).not.toBeNull();
    expect(sp?.length).toBeCloseTo(100, 1);
    expect(near(sp?.at(0).x ?? -1, 0)).toBe(true);
    expect(near(sp?.at(0.5).x ?? -1, 50)).toBe(true);
    expect(near(sp?.at(1).x ?? -1, 100)).toBe(true);
  });

  // The reason for the cumulative-length table: with naive per-segment
  // interpolation, u=0.5 on an L-shape whose legs differ would land in the
  // wrong leg and the layer would visibly speed up at the corner.
  it('keeps a constant pace across segments of different lengths', () => {
    const sp = samplePath('M 0 0 L 90 0 L 90 10');
    expect(sp?.length).toBeCloseTo(100, 1);
    expect(near(sp?.at(0.45).x ?? -1, 45)).toBe(true);
    const end = sp?.at(1);
    expect(near(end?.x ?? -1, 90)).toBe(true);
    expect(near(end?.y ?? -1, 10)).toBe(true);
  });

  it('reports a heading that follows the direction of travel', () => {
    const right = samplePath('M 0 0 L 100 0')?.at(0.5).angle ?? NaN;
    const down = samplePath('M 0 0 L 0 100')?.at(0.5).angle ?? NaN;
    expect(near(right, 0, 1)).toBe(true);
    expect(near(down, 90, 1)).toBe(true);
  });

  it('follows a quadratic through its control point without overshooting it', () => {
    const sp = samplePath('M 0 0 Q 50 -100 100 0');
    const mid = sp?.at(0.5);
    expect(near(mid?.x ?? -1, 50, 2)).toBe(true);
    // A quadratic reaches half the control offset at its midpoint, never -100.
    expect(mid?.y ?? 0).toBeLessThan(-40);
    expect(mid?.y ?? 0).toBeGreaterThan(-60);
  });

  it('clamps out-of-range progress instead of running off the end', () => {
    const sp = samplePath('M 0 0 L 100 0');
    expect(near(sp?.at(-5).x ?? -1, 0)).toBe(true);
    expect(near(sp?.at(9).x ?? -1, 100)).toBe(true);
  });

  it('is null for a path it cannot walk', () => {
    expect(samplePath('M 0 0 A 5 5 0 0 1 10 10')).toBeNull();
  });
});
