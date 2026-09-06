import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFontMetrics, metricsForFamily, charOffsets, graphemes } from './font-metrics';

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
    expect(charOffsets('', 20, null)).toEqual({ offsets: [], total: 0, exact: false, units: [] });
  });
});

describe('graphemes — clusters, not code points', () => {
  it('keeps a decomposed accent attached to its letter', () => {
    // "café" is 5 code points but 4 characters; splitting by code point
    // gave the combining acute a layer of its own with nothing to sit on.
    expect(graphemes('café')).toEqual(['c', 'a', 'f', 'é']);
  });

  it('keeps a ZWJ emoji sequence in one piece', () => {
    // 👨‍👩‍👧 is three people joined by two zero-width joiners — 5 code points
    // that shattered into 3 figures plus 2 invisible layers.
    expect(graphemes('x\u{1F468}‍\u{1F469}‍\u{1F467}y')).toHaveLength(3);
  });

  it('keeps a regional-indicator flag in one piece', () => {
    expect(graphemes('\u{1F1EC}\u{1F1E7}')).toEqual(['\u{1F1EC}\u{1F1E7}']);
  });

  it('is unchanged for plain ASCII', () => {
    expect(graphemes('Hi there')).toEqual(['H', 'i', ' ', 't', 'h', 'e', 'r', 'e']);
  });

  it('offsets are keyed by grapheme, and a cluster sums its parts', () => {
    const r = charOffsets('café', 40, null);
    expect(r.units).toEqual(['c', 'a', 'f', 'é']);
    expect(r.offsets).toHaveLength(4);
    // The last cluster is two code points, so it is twice a plain one's width
    // under the fallback ratio — the run stays as wide as the text really is.
    expect(r.total - (r.offsets[3] as number)).toBeCloseTo(40 * 0.54 * 2, 5);
  });
});
