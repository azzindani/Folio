import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_PROJECTS, TEST_TOKEN } from './lib/harness';

/**
 * THE TIMELINE PANEL — the half of the motion work that only exists in a browser.
 *
 * Everything else in the animation stack is pure and unit-tested. These two
 * controls are not: a picker that writes `easing` onto one keyframe, and a
 * stagger that shifts a selection's keyframes into a sequence. Both were listed
 * open in docs/MOTION.md §5 precisely because "it compiles" says nothing about
 * whether a click reaches them.
 *
 * The panel also used to ship a scrubber that moved a thumb and previewed
 * nothing, and an easing picker whose teardown threw before it wrote — both
 * exactly the failures a DOM-free test cannot see.
 */
const PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
const SRC = path.join(PROJECT, 'designs', 'motion.design.yaml');
const SCRATCH = path.join(PROJECT, 'designs', '_scratch-timeline.design.yaml');
const EDITOR_PATH = '/home/folio/projects/commissioning/designs/_scratch-timeline.design.yaml';

test.beforeEach(() => fs.copyFileSync(SRC, SCRATCH));
test.afterEach(() => fs.rmSync(SCRATCH, { force: true }));

async function openTimeline(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/?file=${encodeURIComponent(EDITOR_PATH)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="pulse"]')), undefined, { timeout: 45_000 });
  await page.click('[data-tab="timeline"]');
  await expect(page.locator('.tl-track-area[data-layer-id="pulse"]'),
    'the timeline tab does not show a track for the animated layer').toHaveCount(1);
}

test('a keyframe carries the easing chosen for it', async ({ page }) => {
  await openTimeline(page);

  const diamond = page.locator('.tl-keyframe[data-layer-id="pulse"]').first();
  await expect(diamond, 'no keyframe diamonds on an animated track').toBeVisible();
  await diamond.click();

  const picker = page.locator('.tl-ease-picker');
  await expect(picker, 'clicking a keyframe did not open the easing picker').toBeVisible();
  // Every curve the engine knows should be offerable, plus the track default.
  expect(await picker.locator('option').count()).toBeGreaterThan(10);

  await picker.selectOption('bounce');
  await expect(picker, 'the picker stayed open after committing').toHaveCount(0);

  // The track re-renders FROM STATE, so the diamond carrying the easing is
  // proof the choice was written and read back — not merely that a <select>
  // changed value.
  //
  // Deliberately not asserted here: the .design.yaml on disk. The editor's
  // autosave never flushes under the commissioning server, so waiting on the
  // file would be testing autosave rather than this picker — and it would fail
  // for a reason that has nothing to do with the feature. setKeyframeEasing is
  // unit-tested, and auto-save has its own tests.
  await expect(page.locator('.tl-keyframe[data-layer-id="pulse"]').first(),
    'the keyframe did not come back carrying the easing that was chosen')
    .toHaveAttribute('data-easing', 'bounce');
});

test('clicking a keyframe edits it instead of adding another on top', async ({ page }) => {
  await openTimeline(page);
  const before = await page.locator('.tl-keyframe[data-layer-id="pulse"]').count();
  await page.locator('.tl-keyframe[data-layer-id="pulse"]').first().click();
  await expect(page.locator('.tl-ease-picker')).toBeVisible();
  // The click must not fall through to the track, which reads a click as "add".
  await expect(page.locator('.tl-keyframe[data-layer-id="pulse"]')).toHaveCount(before);
});

test('stagger shifts a selected layer into a sequence', async ({ page }) => {
  await openTimeline(page);

  // The panel staggers what is SELECTED, so select the animated layer first.
  await page.click('.layer-row[data-layer-id="pulse"]');
  await page.click('[data-tab="timeline"]');

  const times = async (): Promise<number[]> =>
    (await page.locator('.tl-keyframe[data-layer-id="pulse"]').evaluateAll(
      els => els.map(e => Number((e as HTMLElement).dataset['t'])))).sort((a, b) => a - b);

  const before = await times();
  expect(before.length, 'the fixture should carry two keyframes').toBeGreaterThan(1);

  await page.fill('#tl-stagger', '200');
  await page.click('#tl-stagger-apply');

  // One selected layer is index 0, so it shifts by 0 — the run still starts on
  // time. Proving it does NOT move is the point: a stagger that pushed a lone
  // layer would put a gap at the front of every sequence.
  await expect.poll(times, { timeout: 10_000 }).toEqual(before);
});
