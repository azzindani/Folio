import { describe, it, expect } from 'vitest';
import { linearEndpoints, angleFromDrag, radialCenter, radialRadiusPoint, radiusFromDrag } from './gradient-handles';

describe('linearEndpoints', () => {
  it('matches the renderer formula at angle 0 (vertical axis)', () => {
    const { p1, p2 } = linearEndpoints(0);
    // angle 0 → r=-90° → p1 bottom (y=1), p2 top (y=0); x centered
    expect(p1.x).toBeCloseTo(0.5, 5); expect(p1.y).toBeCloseTo(1, 5);
    expect(p2.x).toBeCloseTo(0.5, 5); expect(p2.y).toBeCloseTo(0, 5);
  });
  it('angle 90 → horizontal axis (p1 left, p2 right)', () => {
    const { p1, p2 } = linearEndpoints(90);
    expect(p1.x).toBeCloseTo(0, 5); expect(p2.x).toBeCloseTo(1, 5);
    expect(p1.y).toBeCloseTo(0.5, 5); expect(p2.y).toBeCloseTo(0.5, 5);
  });
});

describe('angleFromDrag', () => {
  it('is the inverse of linearEndpoints for p2', () => {
    for (const a of [0, 45, 90, 135, 200, 315]) {
      const { p2 } = linearEndpoints(a);
      // vector from center (0.5,0.5) to p2
      const back = angleFromDrag(p2.x - 0.5, p2.y - 0.5, 'p2');
      expect(back).toBe(a);
    }
  });
  it('dragging p1 yields the same axis angle as p2', () => {
    const { p1 } = linearEndpoints(135);
    expect(angleFromDrag(p1.x - 0.5, p1.y - 0.5, 'p1')).toBe(135);
  });
});

describe('radial helpers', () => {
  it('center + radius points use %/100 fractions', () => {
    expect(radialCenter(50, 50)).toEqual({ x: 0.5, y: 0.5 });
    expect(radialRadiusPoint(50, 50, 40)).toEqual({ x: 0.9, y: 0.5 });
    expect(radialCenter()).toEqual({ x: 0.5, y: 0.5 });
  });
  it('radiusFromDrag clamps to 1..200', () => {
    expect(radiusFromDrag(200, 400)).toBe(50);
    expect(radiusFromDrag(0, 400)).toBe(1);
    expect(radiusFromDrag(2000, 400)).toBe(200);
  });
});
