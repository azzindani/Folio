import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { designPath, serverExport, openDesign, collectRegions } from './lib/harness';
import { measureInk, pageInk, fileToDataUri } from './lib/ink';

/**
 * RENDER INTEGRITY — the engine's standing promises about any render, as
 * opposed to any one feature:
 *
 *   nothing comes out blank · text is actually visible · the same input gives
 *   the same output · what it cannot draw, it reports rather than hides.
 *
 * Each maps to a failure this project has actually shipped: a z-sort NaN that
 * blanked whole posters, a dropped style that flattened text into invisibility,
 * a render cache whose clones lost their <defs>, and srcs that quietly resolved
 * to nothing.
 */

const INK_FLOOR = 0.02;

let OUT = '';
test.beforeAll(() => { OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-integrity-')); });
test.afterAll(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

test('a rendered poster is never blank', async ({ page }) => {
  const res = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'blank-check.png'));
  expect(res.ok).toBe(true);

  const ink = await pageInk(page, fileToDataUri(res.files[0] as string));
  // A blank export is not a subtle regression — it is 0.00 against a floor of
  // 0.05, and it has shipped here before (z-sort NaN dropped every layer).
  expect(ink.inkRatio, 'the page is empty').toBeGreaterThan(0.05);
  expect(ink.colours, 'the page is a single flat colour').toBeGreaterThan(3);
});

test('every text layer puts ink on the page', async ({ page }) => {
  const res = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'text-check.png'));
  expect(res.ok).toBe(true);

  await openDesign(page, 'poster-assets');
  const text = (await collectRegions(page)).filter(r => r.kind === 'text');
  expect(text.length, 'fixture should present text').toBeGreaterThanOrEqual(2);

  const stats = await measureInk(page, fileToDataUri(res.files[0] as string), text);
  const invisible = stats.filter(s => s.inkRatio < INK_FLOOR);
  // Catches text rendered in the background colour, at zero opacity, or with a
  // dropped style — all of which "render" without being readable.
  expect(invisible, `text present in the spec but not on the page:\n${
    stats.map(s => `${s.id}: ink=${s.inkRatio.toFixed(3)}`).join('\n')}`).toEqual([]);
});

test('the same design renders byte-identically twice', () => {
  const a = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'det-a.png'));
  const b = serverExport(designPath('poster-assets'), 'png', path.join(OUT, 'det-b.png'));
  expect(a.ok && b.ok).toBe(true);

  const [bufA, bufB] = [fs.readFileSync(a.files[0] as string), fs.readFileSync(b.files[0] as string)];
  // Non-determinism here has meant per-render id collisions and cached layer
  // clones losing their <defs> — both of which surface as "it looked fine
  // yesterday" rather than as an error.
  expect(bufA.equals(bufB), 'two renders of one design differ').toBe(true);
});

test('an unresolvable src is reported and drawn as a placeholder, never silently dropped', async ({ page }) => {
  const res = serverExport(designPath('unresolvable'), 'png', path.join(OUT, 'unresolvable.png'));
  expect(res.ok, 'one bad src must not fail the whole export').toBe(true);

  // Both srcs must be called out — a note is how the model learns to fix it.
  const notes = res.notes.join('\n');
  expect(res.notes.length, `expected notes for both bad srcs, got:\n${notes}`).toBeGreaterThanOrEqual(2);
  expect(notes).toMatch(/escapes/);
  expect(notes).toMatch(/absent/);
  expect(notes, 'a src climbing out of the project must be named as such').toMatch(/outside the project/i);

  // …and the page must SHOW something is missing rather than look complete.
  const ink = await pageInk(page, fileToDataUri(res.files[0] as string));
  expect(ink.inkRatio, 'placeholders were not drawn').toBeGreaterThan(0.01);
});

test('a src that climbs out of the project never embeds file bytes', () => {
  const res = serverExport(designPath('unresolvable'), 'svg', path.join(OUT, 'unresolvable.svg'));
  expect(res.ok).toBe(true);
  const svg = fs.readFileSync(res.files[0] as string, 'utf8');

  // The security half of the contract: refusing to render is not enough if the
  // bytes still get inlined into the artifact.
  expect(svg).not.toContain('/etc/');
  expect(svg).not.toMatch(/href="\.\.\//);
});
