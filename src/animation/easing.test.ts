import { describe, it, expect } from 'vitest';
import {
  EASINGS, EASING_NAMES, resolveEasing, easingToCSS, bakeEasing,
  isKnownEasing, parseCubicBezier, parseSteps, describeEasings,
} from './easing';

describe('easing library', () => {
  it('every named curve starts at 0 and ends at 1', () => {
    for (const name of EASING_NAMES) {
      const fn = EASINGS[name].fn;
      expect(fn(0), name).toBeCloseTo(0, 6);
      expect(fn(1), name).toBeCloseTo(1, 6);
    }
  });

  it('bezier solver matches the browser for the CSS five', () => {
    // Reference values from Chrome for cubic-bezier(0.42, 0, 0.58, 1) at t=0.5.
    expect(resolveEasing('ease-in-out')(0.5)).toBeCloseTo(0.5, 3);
    expect(resolveEasing('ease-in')(0.5)).toBeLessThan(0.5);
    expect(resolveEasing('ease-out')(0.5)).toBeGreaterThan(0.5);
    expect(resolveEasing('linear')(0.37)).toBeCloseTo(0.37, 6);
  });

  it('parses cubic-bezier strings and evaluates them', () => {
    expect(parseCubicBezier('cubic-bezier(0.2, 0.8, 0.4, 1)')).toEqual([0.2, 0.8, 0.4, 1]);
    expect(parseCubicBezier('cubic-bezier(1.5, 0, 0.5, 1)')?.[0]).toBe(1); // x clamped
    expect(parseCubicBezier('nope')).toBeNull();
    const fn = resolveEasing('cubic-bezier(0.34, 1.56, 0.64, 1)');
    // Overshoot: somewhere in the middle the value exceeds 1.
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => fn(i / 49)));
    expect(peak).toBeGreaterThan(1.05);
  });

  it('steps() jumps discretely', () => {
    expect(parseSteps('steps(4)')).toEqual({ n: 4, jump: 'end' });
    expect(parseSteps('steps(3, start)')).toEqual({ n: 3, jump: 'start' });
    const fn = resolveEasing('steps(4)');
    expect(fn(0.1)).toBe(0);
    expect(fn(0.26)).toBe(0.25);
    expect(fn(1)).toBe(1);
    const start = resolveEasing('steps(2, start)');
    expect(start(0.01)).toBe(0.5);
  });

  it('overshoot and oscillating curves leave [0,1] as intended', () => {
    const back = resolveEasing('ease-out-back');
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => back(i / 49)))).toBeGreaterThan(1);
    const bounce = resolveEasing('bounce');
    // Bounce never exceeds 1 but dips back down after first contact.
    const vals = Array.from({ length: 100 }, (_, i) => bounce(i / 99));
    expect(Math.max(...vals)).toBeLessThanOrEqual(1.0001);
    let dips = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) dips++;
    expect(dips).toBeGreaterThan(0);
    const spring = resolveEasing('spring');
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 99)))).toBeGreaterThan(1.05);
  });

  it('hold is a step at the end of the segment', () => {
    const fn = resolveEasing('hold');
    expect(fn(0.99)).toBe(0);
    expect(fn(1)).toBe(1);
  });

  it('unknown names fall back to ease-in-out rather than throwing', () => {
    expect(resolveEasing('whatever')(0.5)).toBeCloseTo(0.5, 3);
    expect(easingToCSS('whatever')).toBe('ease-in-out');
    expect(isKnownEasing('whatever')).toBe(false);
    expect(isKnownEasing('ease-out-expo')).toBe(true);
    expect(isKnownEasing('cubic-bezier(0,0,1,1)')).toBe(true);
    expect(isKnownEasing(42)).toBe(false);
  });

  it('easingToCSS gives a bezier where one exists and null where it must be baked', () => {
    expect(easingToCSS('ease-out')).toBe('ease-out');
    expect(easingToCSS('ease-out-expo')).toMatch(/^cubic-bezier\(/);
    expect(easingToCSS('pop')).toMatch(/1\.56/);
    expect(easingToCSS('bounce')).toBeNull();
    expect(easingToCSS('ease-out-elastic')).toBeNull();
    expect(easingToCSS('hold')).toBe('steps(1, end)');
    expect(easingToCSS('steps(5, start)')).toBe('steps(5, start)');
    expect(easingToCSS(undefined)).toBe('ease-in-out');
  });

  it('bakeEasing samples endpoints inclusive', () => {
    const b = bakeEasing('bounce', 8);
    expect(b).toHaveLength(9);
    expect(b[0]).toEqual([0, 0]);
    expect(b[8][0]).toBe(1);
    expect(b[8][1]).toBeCloseTo(1, 6);
  });

  it('describes every curve for tool output', () => {
    const d = describeEasings();
    expect(Object.keys(d).length).toBe(EASING_NAMES.length);
    expect(d['ease-out-back']).toContain('pop');
  });
});
