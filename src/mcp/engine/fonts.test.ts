import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bundledFamilies, unbundledFonts, resvgFontOption, fontsDir, projectFontsDir, projectFontFamilies } from './fonts';

/** Minimal sfnt carrying one `name` record — enough for readFontNames. */
function fontWithFamily(family: string): Buffer {
  const text = Buffer.from(family.split('').flatMap(c => [0, c.charCodeAt(0)]));
  const rec = Buffer.alloc(12);
  rec.writeUInt16BE(3, 0); rec.writeUInt16BE(1, 2); rec.writeUInt16BE(0, 4);
  rec.writeUInt16BE(1, 6); rec.writeUInt16BE(text.length, 8); rec.writeUInt16BE(0, 10);
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0); head.writeUInt16BE(1, 2); head.writeUInt16BE(18, 4);
  const name = Buffer.concat([head, rec, text]);
  const dir = Buffer.alloc(28);
  dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(1, 4);
  dir.write('name', 12, 4, 'latin1');
  dir.writeUInt32BE(0, 16); dir.writeUInt32BE(28, 20); dir.writeUInt32BE(name.length, 24);
  return Buffer.concat([dir, name]);
}

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
  // projectFontFamilies unions the SHARED library's fonts (a design using one
  // must not be reported as unbundled), so these tests must not read whatever
  // library the machine happens to have — point it at an empty directory.
  let libTmp: string, prevLib: string | undefined;
  beforeEach(() => {
    libTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fonts-lib-'));
    prevLib = process.env['FOLIO_LIBRARY_DIR'];
    process.env['FOLIO_LIBRARY_DIR'] = libTmp;
  });
  afterEach(() => {
    if (prevLib === undefined) delete process.env['FOLIO_LIBRARY_DIR'];
    else process.env['FOLIO_LIBRARY_DIR'] = prevLib;
    fs.rmSync(libTmp, { recursive: true, force: true });
  });

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

  it('registers the family a font DECLARES, not only the one its filename implies', () => {
    // The case this exists for: a downloaded family whose static weights carry
    // the variable font's default-instance name. resvg matches the declared
    // name, so a design using it must not be reported as an unbundled font.
    const dir = tmpProjectWithFonts([]);
    fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'space-grotesk-700.ttf'),
      fontWithFamily('Space Grotesk Light'));
    const fams = projectFontFamilies(dir);
    expect(fams.has('space grotesk light')).toBe(true);   // what the file says
    expect(fams.has('space grotesk')).toBe(true);         // what the name says
    const svg = '<text font-family="Space Grotesk Light">x</text>';
    expect(unbundledFonts(svg, dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the filename when the file is not a parseable font', () => {
    const dir = tmpProjectWithFonts(['Clash_Display-Bold.ttf']);   // contents: "x"
    expect(projectFontFamilies(dir).has('clash display')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('counts a SHARED library font as available, at any depth', () => {
    const dir = tmpProjectWithFonts(['Inter-Regular.ttf']);
    const deep = path.join(libTmp, 'fonts', 'display');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'anton-400.ttf'), fontWithFamily('Anton'));
    const fams = projectFontFamilies(dir);
    expect(fams.has('anton')).toBe(true);                 // from the library
    expect(fams.has('inter')).toBe(true);                 // from the project
    // The whole point: a design using a library font is NOT flagged unbundled.
    expect(unbundledFonts('<text font-family="Anton">x</text>', dir)).toEqual([]);
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
