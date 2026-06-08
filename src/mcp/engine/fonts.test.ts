import { describe, it, expect } from 'vitest';
import { bundledFamilies, unbundledFonts, resvgFontOption, fontsDir } from './fonts';

describe('bundled fonts manifest', () => {
  it('loads the curated families Folio steers toward', () => {
    const fams = bundledFamilies();
    // these are the families the engine recommends + this repo bundles
    for (const f of ['space grotesk', 'ibm plex mono', 'inter', 'playfair display']) {
      expect(fams.has(f)).toBe(true);
    }
    expect(fams.has('dejavu sans')).toBe(true);
  });

  it('resvg font option points at the bundled dir with DejaVu as fallback', () => {
    const opt = resvgFontOption();
    expect(opt.fontDirs).toContain(fontsDir());
    expect(opt.defaultFontFamily).toBe('DejaVu Sans');
  });
});

describe('unbundledFonts', () => {
  it('returns nothing when every referenced family is bundled', () => {
    const svg = '<text font-family="Space Grotesk">a</text><text font-family="IBM Plex Mono">b</text>';
    expect(unbundledFonts(svg)).toEqual([]);
  });

  it('flags a family that is not bundled (would fall back to DejaVu in raster)', () => {
    const svg = '<text font-family="Pacifico">a</text><text font-family="Inter">b</text>';
    expect(unbundledFonts(svg)).toEqual(['Pacifico']);
  });

  it('ignores generic keywords and dedupes', () => {
    const svg = '<text font-family="sans-serif">a</text><text font-family="Pacifico">b</text><text font-family="Pacifico">c</text>';
    expect(unbundledFonts(svg)).toEqual(['Pacifico']);
  });

  it('reads the first family from a font stack', () => {
    // first family bundled → not flagged
    expect(unbundledFonts('<text font-family="Inter, sans-serif">a</text>')).toEqual([]);
    // first family not bundled → flagged
    expect(unbundledFonts('<text font-family="Lobster, Inter">a</text>')).toEqual(['Lobster']);
  });
});
