import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  designPath, serverExport, openDesign, collectRegions, TEST_TOKEN,
  type Region,
} from './lib/harness';
import { measureInk, pageInk, fileToDataUri } from './lib/ink';

/**
 * EXPORT FIDELITY — the artifact the user receives must contain the design.
 *
 * This is the check the suite was missing when every editor export silently
 * dropped every asset: 3690 unit tests passed, and the e2e export test passed
 * too, because it asserted the file began with %PDF- and embedded a font. A
 * PDF with no artwork on it satisfies both.
 */

/** Below this, a region is flat — the artwork that belongs there is missing. */
const INK_FLOOR = 0.02;

let OUT = '';
test.beforeAll(() => { OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-commission-')); });
test.afterAll(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

function imagesOf(regions: Region[]): Region[] {
  return regions.filter(r => r.kind === 'image');
}

function report(stats: Array<{ id: string; inkRatio: number; colours: number }>): string {
  return stats.map(s => `${s.id}: ink=${s.inkRatio.toFixed(3)} colours=${s.colours}`).join('\n');
}

test.describe('server engine (MCP export_design)', () => {
  test('PNG paints every asset — project store, shared library and raster alike', async ({ page }) => {
    const res = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'poster.png'));
    expect(res.error ?? '', 'export must not error').toBe('');
    expect(res.ok, 'export reported failure').toBe(true);
    expect(res.files.length, 'no file written').toBe(1);

    await openDesign(page, 'poster-assets');
    const regions = imagesOf(await collectRegions(page));
    expect(regions.length, 'fixture should present 4 image regions').toBeGreaterThanOrEqual(4);

    const stats = await measureInk(page, fileToDataUri(res.files[0] as string), regions);
    const flat = stats.filter(s => s.inkRatio < INK_FLOOR);
    expect(flat, `flat regions — asset missing from the PNG:\n${report(stats)}`).toEqual([]);
  });

  test('SVG is self-contained — no href the file cannot resolve on its own', async () => {
    const res = serverExport(designPath('poster-assets'), 'svg', path.join(OUT, 'poster.svg'));
    expect(res.ok).toBe(true);
    const svg = fs.readFileSync(res.files[0] as string, 'utf8');

    // An image FILL renders href AND xlink:href on the same element, so count
    // TAGS and check each one, rather than counting data: URIs.
    const tags = svg.match(/<image\b[^>]*>/g) ?? [];
    expect(tags.length, 'fixture images did not reach the SVG').toBeGreaterThanOrEqual(4);
    const notInlined = tags.filter(t => {
      const hrefs = [...t.matchAll(/(?:xlink:)?href="([^"]*)"/g)].map(m => m[1] ?? '');
      return hrefs.length === 0 || hrefs.some(h => !h.startsWith('data:'));
    });
    expect(notInlined, 'an image is not inlined').toEqual([]);
    expect(svg, 'a served URL leaked into a portable file').not.toContain('/__project_files/');
    expect(svg).not.toContain('href=""');
  });

  test('PDF carries real image data, not just a font and a header', async () => {
    const res = serverExport(designPath('poster-assets'), 'pdf', path.join(OUT, 'poster.pdf'));
    expect(res.ok).toBe(true);
    const pdf = fs.readFileSync(res.files[0] as string, 'latin1');
    expect(pdf.slice(0, 5)).toBe('%PDF-');
    // The old bar stopped here. This is the part that catches a blank page:
    const xobjects = pdf.match(/\/Subtype\s*\/Image/g)?.length ?? 0;
    expect(xobjects, 'PDF contains no image XObject').toBeGreaterThanOrEqual(1);
  });

  test('every page of a multi-page deck is exported AND non-blank', async ({ page }) => {
    const res = serverExport(designPath('deck-pages'), 'png', path.join(OUT, 'deck.png'));
    expect(res.ok).toBe(true);
    expect(res.files.length, 'one file per page').toBe(3);

    // "3 files written" is not the same as "3 pages rendered".
    for (const file of res.files) {
      const ink = await pageInk(page, fileToDataUri(file));
      expect(ink.inkRatio, `${path.basename(file)} is blank`).toBeGreaterThan(0.01);
      expect(ink.colours, `${path.basename(file)} has a single flat colour`).toBeGreaterThan(2);
    }
  });
});

test.describe('editor engine (browser export)', () => {
  test('the PNG the Export button produces contains every asset', async ({ page }) => {
    await openDesign(page, 'poster-assets');
    const regions = imagesOf(await collectRegions(page));
    expect(regions.length).toBeGreaterThanOrEqual(4);

    // Headless cannot complete a file picker; force the anchor-download branch.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = undefined;
    });
    await page.click('button[data-action="export"]');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.click('.export-item[data-format="png"]'),
    ]);
    const file = path.join(OUT, 'editor-export.png');
    await download.saveAs(file);

    const stats = await measureInk(page, fileToDataUri(file), regions);
    const flat = stats.filter(s => s.inkRatio < INK_FLOOR);
    expect(flat, `flat regions — the export dropped an asset:\n${report(stats)}`).toEqual([]);
  });

  test('assets are served to the canvas in the first place', async ({ page }) => {
    // Separates "the export lost it" from "it was never there" — the two look
    // identical in a screenshot and need completely different fixes.
    await openDesign(page, 'poster-assets');
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('image')].map(i => i.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);

    const statuses = await Promise.all(hrefs
      .filter(h => h.startsWith('/'))
      .map(async h => (await page.request.get(`${h}${h.includes('?') ? '&' : '?'}token=${TEST_TOKEN}`)).status()));
    expect(statuses.filter(s => s !== 200), `asset requests failed: ${statuses}`).toEqual([]);
  });
});
