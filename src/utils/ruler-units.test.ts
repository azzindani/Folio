import { describe, it, expect } from 'vitest';
import {
  pxToUnit,
  unitToPx,
  formatRulerValue,
  nextRulerUnit,
  computeRulerTicks,
} from './ruler-units';

describe('pxToUnit', () => {
  it('px → px is identity', () => {
    expect(pxToUnit(100, 'px')).toBe(100);
  });

  it('px → mm uses 96 DPI', () => {
    expect(pxToUnit(96, 'mm')).toBeCloseTo(25.4);
  });

  it('px → cm', () => {
    expect(pxToUnit(96, 'cm')).toBeCloseTo(2.54);
  });

  it('px → in: 96px = 1in', () => {
    expect(pxToUnit(96, 'in')).toBeCloseTo(1);
  });

  it('zero input yields zero', () => {
    expect(pxToUnit(0, 'mm')).toBe(0);
  });
});

describe('unitToPx', () => {
  it('is inverse of pxToUnit', () => {
    expect(unitToPx(pxToUnit(200, 'mm'), 'mm')).toBeCloseTo(200);
    expect(unitToPx(pxToUnit(150, 'cm'), 'cm')).toBeCloseTo(150);
    expect(unitToPx(pxToUnit(72, 'in'), 'in')).toBeCloseTo(72);
  });

  it('1 inch = 96 px', () => {
    expect(unitToPx(1, 'in')).toBeCloseTo(96);
  });
});

describe('formatRulerValue', () => {
  it('px: rounds to integer', () => {
    expect(formatRulerValue(100.7, 'px')).toBe('101');
  });

  it('mm: 1 decimal place', () => {
    const val = formatRulerValue(96, 'mm');
    expect(val).toMatch(/^\d+\.\d$/);
  });

  it('cm: 2 decimal places', () => {
    const val = formatRulerValue(96, 'cm');
    expect(val).toMatch(/^\d+\.\d{2}$/);
  });

  it('in: 3 decimal places', () => {
    const val = formatRulerValue(96, 'in');
    expect(val).toMatch(/^\d+\.\d{3}$/);
    expect(val).toBe('1.000');
  });
});

describe('nextRulerUnit', () => {
  it('cycles px → mm → cm → in → px', () => {
    expect(nextRulerUnit('px')).toBe('mm');
    expect(nextRulerUnit('mm')).toBe('cm');
    expect(nextRulerUnit('cm')).toBe('in');
    expect(nextRulerUnit('in')).toBe('px');
  });
});

describe('computeRulerTicks', () => {
  it('returns ticks within range', () => {
    const ticks = computeRulerTicks(0, 1080, 'px', 1);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.px).toBeGreaterThanOrEqual(0);
      expect(t.px).toBeLessThanOrEqual(1080);
    }
  });

  it('returns fewer ticks when zoomed out', () => {
    const zoomedIn  = computeRulerTicks(0, 1080, 'px', 2);
    const zoomedOut = computeRulerTicks(0, 1080, 'px', 0.25);
    expect(zoomedIn.length).toBeGreaterThanOrEqual(zoomedOut.length);
  });

  it('returns correct labels for mm unit', () => {
    const ticks = computeRulerTicks(0, 500, 'mm', 1);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0].label).toMatch(/^\d+\.\d$/);
  });

  it('empty range produces at most 1 tick', () => {
    const ticks = computeRulerTicks(100, 100, 'px', 1);
    // A single-point range may hit exactly on a tick boundary
    expect(ticks.length).toBeLessThanOrEqual(1);
  });

  it('negative start (panned past origin) still produces ticks', () => {
    const ticks = computeRulerTicks(-200, 800, 'px', 1);
    const negative = ticks.filter(t => t.px < 0);
    expect(negative.length).toBeGreaterThan(0);
  });
});
