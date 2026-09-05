import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFontMetrics, metricsForFamily, charOffsets } from './font-metrics';

const FONTS = ['dist/fonts', 'public/fonts'].map(d => path.resolve(d)).filter(d => fs.existsSync(d));

describe('parseFontMetrics', () => {
  it('is null for bytes that are not a font', () => {
    expect(parseFontMetrics(Buffer.from('not a font at all'))).toBeNull();
    expect(parseFontMetrics(Buffer.alloc(4))).toBeNull();
  });
});

describe('metricsForFamily', () => {
  it('is null for a family with no file, rather than guessing', () => {
    expect(metricsForFamily('No Such Family Anywhere', FONTS)).toBeNull();
  });

  it('reads a bundled family and reports a sane em size', () => {
    if (FONTS.length === 0) return;
    const m = metricsForFamily('Plus Jakarta Sans', FONTS);
    if (!m) return;                          // font not bundled in this checkout
    expect(m.unitsPerEm).toBeGreaterThanOrEqual(16);
    expect(m.advance('W'.codePointAt(0) as number)).toBeGreaterThan(0);
  });

  // The whole reason this file exists: the layout heuristic gives every glyph
  // one average width, so a per-character split would place "iii" and "WWW"
  // identically and the run would drift apart as it revealed.
  it('distinguishes narrow from wide glyphs in a PROPORTIONAL family', () => {
    if (FONTS.length === 0) return;
    const m = metricsForFamily('Plus Jakarta Sans', FONTS);
    if (!m) return;
    const thin = charOffsets('iii', 100, m).total;
    const wide = charOffsets('WWW', 100, m).total;
    expect(wide).toBeGreaterThan(thin * 2);
  });

  it('gives a MONOSPACE family identical widths, which is the control case', () => {
    if (FONTS.length === 0) return;
    const m = metricsForFamily('Space Mono', FONTS);
    if (!m) return;
    expect(charOffsets('iii', 100, m).total).toBeCloseTo(charOffsets('WWW', 100, m).total, 3);
  });
});

describe('charOffsets', () => {
  it('falls back to a uniform advance and FLAGS it when there are no metrics', () => {
    const r = charOffsets('abc', 100, null);
    expect(r.exact).toBe(false);
    expect(r.total).toBeCloseTo(3 * 54, 5);
    expect(r.offsets).toEqual([0, 54, 108]);
  });

  it('starts at zero and grows monotonically', () => {
    const { offsets } = charOffsets('hello', 20, null);
    expect(offsets[0]).toBe(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('is empty for empty text', () => {
    expect(charOffsets('', 20, null)).toEqual({ offsets: [], total: 0, exact: false });
  });
});
