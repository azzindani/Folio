import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bundledFamilies, unbundledFonts, resvgFontOption, fontsDir, projectFontsDir, projectFontFamilies } from './fonts';

function tmpProjectWithFonts(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fonts-'));
  const fdir = path.join(dir, 'assets', 'fonts');
  fs.mkdirSync(fdir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(fdir, f), 'x');
  return dir;
}

describe('bundled fonts manifest', () => {
  it('loads the curated families Folio steers toward', () => {
    const fams = bundledFamilies();
    // these are the families the engine recommends + this repo bundles
    for (const f of ['space grotesk', 'ibm plex mono', 'inter', 'playfair display']) {
      expect(fams.has(f)).toBe(true);
    }
    // mood-bank display faces — bundled so headlines don't fall back to DejaVu in
    // raster export (the "clean vs great" headline gap). Keep these on disk.
    for (const f of ['orbitron', 'audiowide', 'bricolage grotesque', 'quicksand', 'source serif 4']) {
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

describe('project fonts (WP-1.6)', () => {
  it('projectFontsDir returns the dir when it exists, null otherwise', () => {
    expect(projectFontsDir(undefined)).toBeNull();
    expect(projectFontsDir('/no/such/project')).toBeNull();
    const dir = tmpProjectWithFonts(['Clash_Display-Bold.ttf']);
    expect(projectFontsDir(dir)).toBe(path.join(dir, 'assets', 'fonts'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('projectFontFamilies guesses families from filenames, skipping non-fonts', () => {
    const dir = tmpProjectWithFonts(['Clash_Display-Bold.ttf', 'Inter-Regular.otf', 'readme.txt']);
    const fams = projectFontFamilies(dir);
    expect(fams.has('clash display')).toBe(true);
    expect(fams.has('inter')).toBe(true);
    expect(fams.size).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resvg font option appends the project fonts dir when present', () => {
    const dir = tmpProjectWithFonts(['Inter-Regular.ttf']);
    const opt = resvgFontOption(dir);
    expect(opt.fontDirs).toContain(fontsDir());
    expect(opt.fontDirs).toContain(path.join(dir, 'assets', 'fonts'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a project family is not flagged as unbundled', () => {
    const dir = tmpProjectWithFonts(['Clash_Display-Bold.ttf']);
    const svg = '<text font-family="clash display">a</text>';
    expect(unbundledFonts(svg, dir)).toEqual([]);
    // …but still flagged without the project dir
    expect(unbundledFonts(svg)).toEqual(['clash display']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
