import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { designPath, serverExport, openDesign, collectRegions } from './lib/harness';
import { measureInk, inkOfStandaloneFile, fileToDataUri } from './lib/ink';

/**
 * ARTIFACT PORTABILITY — a file leaves this machine and must still be the
 * design somewhere else: on a colleague's laptop, in PowerPoint, in a browser
 * with no access to the editor's server.
 *
 * Everything here is invisible to a unit test by construction. "Self-contained"
 * cannot be asserted from inside the process that produced the file; you have
 * to open it somewhere else and look.
 */

let OUT = '';
test.beforeAll(() => { OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-portable-')); });
test.afterAll(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

test('exported HTML paints on its own, opened straight off disk', async ({ page }) => {
  const res = serverExport(designPath('poster-assets'), 'html', path.join(OUT, 'poster.html'));
  expect(res.ok).toBe(true);
  const file = res.files[0] as string;

  const html = fs.readFileSync(file, 'utf8');
  // A served URL in a "self-contained" file works right up until the file is
  // opened anywhere else, which is the entire point of the format.
  expect(html, 'a server URL leaked into the standalone file').not.toContain('/__project_files/');

  // Then the real test: open it as a plain file, with no Folio server in play.
  const ink = await inkOfStandaloneFile(page, file);
  expect(ink.inkRatio, 'the standalone HTML rendered nothing').toBeGreaterThan(0.05);
  expect(ink.colours, 'the standalone HTML is one flat colour').toBeGreaterThan(3);
});

test('PPTX carries its media, not just its text', () => {
  const res = serverExport(designPath('poster-assets'), 'pptx', path.join(OUT, 'poster.pptx'));
  expect(res.ok).toBe(true);
  // A .pptx is a zip; entry names sit in the local headers as plain text, so
  // this needs no unzip dependency.
  const raw = fs.readFileSync(res.files[0] as string, 'latin1');
  expect(raw.slice(0, 2), 'not a zip container').toBe('PK');
  const media = raw.match(/ppt\/media\/[A-Za-z0-9_.-]+/g) ?? [];
  expect(new Set(media).size, 'PPTX contains no media parts').toBeGreaterThanOrEqual(1);
  expect(fs.statSync(res.files[0] as string).size, 'PPTX too small to hold artwork').toBeGreaterThan(10_000);
});

test('a project copy shadows the shared library at the same path', async ({ page }) => {
  // Both stores hold lib/brand/shadowed.svg: library blue, project orange.
  // "An image rendered" cannot tell these apart — only its colour can.
  const res = serverExport(designPath('shadowing'), 'png', path.join(OUT, 'shadowing.png'));
  expect(res.ok).toBe(true);
  expect(res.notes, 'the src should resolve cleanly').toEqual([]);

  const [stat] = await measureInk(page, fileToDataUri(res.files[0] as string), [
    { id: 'shadowed', kind: 'image', x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
  ]);
  expect(stat?.inkRatio ?? 0, 'nothing painted at all').toBeGreaterThan(0.5);

  // Compare by distance rather than an exact string: the reported colour is
  // quantised (#E4572E arrives as #e05020), and a literal match would fail for
  // a reason that has nothing to do with which file won.
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const dist = (a: string, b: string): number => {
    const [x, y, z] = rgb(a), [p, q, r] = rgb(b);
    return Math.hypot(x - p, y - q, z - r);
  };
  const got = stat?.dominant ?? '#000000';
  const toProject = dist(got, '#E4572E');   // the project copy
  const toLibrary = dist(got, '#2B4AF2');   // the shared-library copy
  expect(toProject, `expected the PROJECT copy to win; dominant ${got} is nearer the library copy`)
    .toBeLessThan(toLibrary);
});

test('the editor and the server put ink in the same places', async ({ page }) => {
  // "Preview ≠ export" has shipped here before. Comparing the two renders
  // region by region catches divergence without pinning either to a snapshot,
  // so ordinary design edits do not churn a baseline.
  const res = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'agree.png'));
  expect(res.ok).toBe(true);

  await openDesign(page, 'poster-assets');
  const regions = await collectRegions(page);
  const server = await measureInk(page, fileToDataUri(res.files[0] as string), regions);

  const disagreements = server
    .filter(s => s.inkRatio < 0.02)
    .map(s => `${s.id} is present on the canvas but empty in the server render`);
  expect(disagreements, disagreements.join('\n')).toEqual([]);
});
