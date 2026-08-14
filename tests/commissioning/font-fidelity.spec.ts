import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { designPath, serverExport, TEST_TOKEN, type Region } from './lib/harness';
import { fingerprints, hamming, measureInk, fileToDataUri } from './lib/ink';

/**
 * FONT FIDELITY — text must be drawn in the face the design asked for.
 *
 * A fallback is the quietest failure the engine has: the export succeeds, the
 * text is present and readable, every existing check passes, and the design is
 * simply in the wrong typeface. Nothing short of looking at the pixels notices.
 *
 * These checks are DIFFERENTIAL, which is what keeps them offline and stable:
 * the same string is rendered in several declared families and required to come
 * out looking different. No golden images, no glyph knowledge, no network — and
 * nothing to re-bless when a font ships a new version.
 */

/**
 * Bands are 16×16-hashed (256 bits). Measured across the fixture's four faces,
 * the CLOSEST pair of genuinely different faces differs by 20 bits; identical
 * rendering would be 0. 15 sits below the observed floor with room for
 * antialiasing drift, and far above the failure it is there to catch.
 */
const DISTINCT_BITS = 15;

let OUT = '';
test.beforeAll(() => { OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fonts-')); });
test.afterAll(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

/** The four text bands of the typefaces fixture, as page fractions. */
const BANDS: Region[] = [
  { id: 'anton', kind: 'text', x: 0.04, y: 0.06, w: 0.92, h: 0.19 },
  { id: 'garamond', kind: 'text', x: 0.04, y: 0.30, w: 0.92, h: 0.19 },
  { id: 'mono', kind: 'text', x: 0.04, y: 0.53, w: 0.92, h: 0.19 },
  { id: 'bogus', kind: 'text', x: 0.04, y: 0.76, w: 0.92, h: 0.19 },
];

function renderTypefaces(name: string): string {
  const res = serverExport(designPath('typefaces'), 'png', path.join(OUT, `${name}.png`));
  expect(res.error ?? '', 'export must not error').toBe('');
  expect(res.ok).toBe(true);
  return res.files[0] as string;
}

test('every declared family actually draws something', async ({ page }) => {
  const stats = await measureInk(page, fileToDataUri(renderTypefaces('ink')), BANDS);
  const empty = stats.filter(s => s.inkRatio < 0.01);
  expect(empty, `a text band is blank:\n${
    stats.map(s => `${s.id}: ink=${s.inkRatio.toFixed(3)}`).join('\n')}`).toEqual([]);
});

test('declaring a different family produces a visibly different rendering', async ({ page }) => {
  const hashes = await fingerprints(page, fileToDataUri(renderTypefaces('diff')), BANDS);
  const by = new Map(hashes.map(h => [h.id, h.hash]));

  // If font_family were ignored, or every family collapsed onto one fallback,
  // these pairs would be identical — which is precisely the silent failure.
  const pairs: Array<[string, string]> = [
    ['anton', 'garamond'],
    ['anton', 'mono'],
    ['garamond', 'mono'],
  ];
  for (const [a, b] of pairs) {
    const d = hamming(by.get(a) ?? '', by.get(b) ?? '');
    expect(d, `"${a}" and "${b}" render identically (${d} bits differ) — the family was not applied`)
      .toBeGreaterThanOrEqual(DISTINCT_BITS);
  }
});

test('a real family does not silently render as the fallback face', async ({ page }) => {
  const hashes = await fingerprints(page, fileToDataUri(renderTypefaces('fallback')), BANDS);
  const by = new Map(hashes.map(h => [h.id, h.hash]));

  // "bogus" names a family that exists nowhere, so it shows what the fallback
  // looks like. A shipped family that matches it byte for byte was never found.
  for (const real of ['anton', 'garamond', 'mono']) {
    const d = hamming(by.get(real) ?? '', by.get('bogus') ?? '');
    expect(d, `"${real}" is indistinguishable from the fallback face (${d} bits) — the font was not loaded`)
      .toBeGreaterThanOrEqual(DISTINCT_BITS);
  }
});

test('the exported SVG names the family, so a downstream reader can honour it', () => {
  const res = serverExport(designPath('typefaces'), 'svg', path.join(OUT, 'typefaces.svg'));
  expect(res.ok).toBe(true);
  const svg = fs.readFileSync(res.files[0] as string, 'utf8');

  // The raster bakes the face in; a vector file has to carry the NAME or the
  // reader picks its own.
  for (const family of ['Anton', 'EB Garamond', 'JetBrains Mono']) {
    expect(svg, `SVG does not declare "${family}"`).toContain(family);
  }
});

test('the editor serves its font manifest and files locally', async ({ page }) => {
  // The offline safety net. The editor CANVAS pulls design faces from Google
  // Fonts at runtime (styles/font-loader.ts), so this asserts the local set
  // that the vector-PDF path uses is actually served and complete.
  const res = await page.request.get(`/fonts/manifest.json?token=${TEST_TOKEN}`);
  expect(res.status(), '/fonts/manifest.json is not served').toBe(200);
  const manifest = await res.json() as { families?: string[] };
  const families = manifest.families ?? [];
  expect(families.length, 'font manifest lists no families').toBeGreaterThan(10);
  for (const family of ['Anton', 'EB Garamond', 'JetBrains Mono']) {
    expect(families, `manifest omits ${family}`).toContain(family);
  }

  // …and a file named by the manifest must actually download.
  const file = await page.request.get(`/fonts/Anton-Regular.ttf?token=${TEST_TOKEN}`);
  expect(file.status(), 'a manifest font 404s').toBe(200);
  expect((await file.body()).length, 'font file is empty').toBeGreaterThan(10_000);
});
