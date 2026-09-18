// A corner radius arrives in whatever shape the author wrote it. The schema
// says `number | {tl,tr,br,bl}`, but designs in the library carry the CSS array
// form — and the cast-to-object path turned that into four NaNs, a `d` the
// browser refuses, and a layer that renders as nothing at all.
import { describe, it, expect } from 'vitest';
import { resolveRadii, roundedRectPath } from './layer-renderers-shared';
import { renderRect } from './layer-renderers-shapes';
import type { RectLayer } from '../schema/types';

const svg = (): SVGSVGElement => document.createElementNS('http://www.w3.org/2000/svg', 'svg');

describe('resolveRadii', () => {
  it('reads a plain number as all four corners', () => {
    expect(resolveRadii(8)).toEqual({ tl: 8, tr: 8, br: 8, bl: 8 });
  });

  it('reads the CSS array form in corner order', () => {
    expect(resolveRadii([4, 0, 0, 4])).toEqual({ tl: 4, tr: 0, br: 0, bl: 4 });
  });

  it('applies CSS shorthand for 1, 2 and 3 values', () => {
    expect(resolveRadii([6])).toEqual({ tl: 6, tr: 6, br: 6, bl: 6 });
    expect(resolveRadii([6, 2])).toEqual({ tl: 6, tr: 2, br: 6, bl: 2 });
    expect(resolveRadii([6, 2, 1])).toEqual({ tl: 6, tr: 2, br: 1, bl: 2 });
  });

  it('reads the object form, and treats a missing corner as square', () => {
    expect(resolveRadii({ tl: 5, br: 3 })).toEqual({ tl: 5, tr: 0, br: 3, bl: 0 });
  });

  it('never yields NaN for junk', () => {
    for (const bad of [undefined, null, 'abc', {}, [], NaN, { tl: 'x' }]) {
      const r = resolveRadii(bad);
      expect(Object.values(r).every(Number.isFinite)).toBe(true);
    }
  });

  it('clamps each corner to half the box so two radii cannot cross', () => {
    expect(resolveRadii(100, 20, 40)).toEqual({ tl: 10, tr: 10, br: 10, bl: 10 });
  });

  it('parses a numeric string, because YAML quotes get everywhere', () => {
    expect(resolveRadii(['4', '0', '0', '4'])).toEqual({ tl: 4, tr: 0, br: 0, bl: 4 });
  });
});

describe('roundedRectPath', () => {
  it('emits no NaN for the array form', () => {
    const d = roundedRectPath(90, 706, 8, 250, [4, 0, 0, 4] as unknown as { tl: number; tr: number; br: number; bl: number });
    expect(d).not.toContain('NaN');
  });
});

describe('renderRect', () => {
  const base: RectLayer = { id: 'accent', type: 'rect', z: 0, x: 90, y: 706, width: 8, height: 250 };

  it('renders the array form as a real path', () => {
    const el = renderRect({ ...base, radius: [4, 0, 0, 4] as unknown as RectLayer['radius'] }, svg());
    expect(el.tagName).toBe('path');
    expect(el.getAttribute('d')).not.toContain('NaN');
  });

  it('keeps a numeric radius on a plain rect', () => {
    const el = renderRect({ ...base, radius: 6 }, svg());
    expect(el.tagName).toBe('rect');
    expect(el.getAttribute('rx')).toBe('4'); // clamped to half of the 8px width
  });
});
