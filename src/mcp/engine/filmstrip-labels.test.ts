import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { filmstripSVG } from './motion-preview';
import { resvgFontOption } from './fonts';

/**
 * The labels have to survive the RASTERISER, not just the string builder.
 *
 * motion-preview-suite.test.ts asserts the timecodes are in the SVG, and they
 * always were. The strip's own Resvg call was the one render in the file
 * without `font:` — every sibling one line away had it — so resvg could not
 * resolve the generic `monospace` family and dropped every label without a
 * word. The poses were labelled on a developer machine and arrived bare from
 * the container, which is precisely what an SVG-level assertion cannot see.
 */

// A 1×1 PNG, enough to stand in for a rendered pose.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Non-ground pixels in the strip's bottom band — the scene-summary line.
 *
 * Scanning only that band is what makes the check unambiguous: no cell, no
 * border and no pose art ever reaches those rows, so every pixel that is not
 * the #14161A ground is a glyph. Counting pixels rather than comparing PNG
 * sizes means the test fails for the reason it claims to test.
 */
function glyphPixels(svg: string, font: Record<string, unknown>): number {
  const img = new Resvg(svg, { background: '#14161A', ...font }).render();
  const { pixels, width, height } = img;
  let n = 0;
  for (let y = height - 16; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0;
      if (!(r < 40 && g < 45 && b < 50)) n++;
    }
  }
  return n;
}

describe('the filmstrip labels reach the PNG', () => {
  const cells = [{ png: PIXEL, t: 0 }, { png: PIXEL, t: 500 }, { png: PIXEL, t: 1000 }];

  it('puts actual glyphs on the strip when given a font database', () => {
    const svg = filmstripSVG(cells, 120, 120, 1000);
    expect(glyphPixels(svg, { font: resvgFontOption() }),
      'the strip rasterised with no label glyphs at all').toBeGreaterThan(50);
  });

  it('draws nothing when the font database is empty — the bug, reproduced', () => {
    // Not a requirement, a WITNESS: this is exactly what the container did, and
    // it is why the previous test has to rasterise rather than read the SVG.
    const svg = filmstripSVG(cells, 120, 120, 1000);
    expect(glyphPixels(svg, { font: { loadSystemFonts: false, fontDirs: [] } })).toBe(0);
  });

  it('names a family that is actually present, not only generics', () => {
    const svg = filmstripSVG(cells, 120, 120, 1000);
    const family = /font-family="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(family).toContain('monospace');
    expect(family, 'every family listed is a generic; resvg drops what it cannot resolve')
      .toMatch(/DejaVu Sans/);
  });

  it('still carries every timecode and the scene summary', () => {
    const svg = filmstripSVG(cells, 120, 120, 1000);
    for (const t of ['0ms', '500ms', '1000ms']) expect(svg).toContain(t);
    expect(svg).toContain('scene 1000ms · 3 poses');
  });
});
