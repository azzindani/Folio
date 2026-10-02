import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_PROJECTS, TEST_TOKEN } from './lib/harness';

/**
 * THE CLIP TRACK — footage edited by hand in the timeline.
 *
 * The cut/trim arithmetic is unit-tested (animation/video-clip.ts,
 * ui/panels/timeline-clips.ts). What only a browser shows: that a video row
 * draws a clip block at all, that ✂ Split reaches the clip under the playhead,
 * and that a pointer drag on a grip lands as a trim read back from state.
 *
 * The clip's file is deliberately absent — the track is drawn from the spec,
 * and commissioning carries no binary footage.
 */
const PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
const SCRATCH = path.join(PROJECT, 'designs', '_scratch-clips.design.yaml');
const EDITOR_PATH = '/home/folio/projects/commissioning/designs/_scratch-clips.design.yaml';

const DESIGN = `_protocol: design/v1
_mode: complete
meta: {id: commissioning-clips, name: Clips, type: poster, created: '2026-10-02', modified: '2026-10-02', generator: test-fixture}
document: {width: 400, height: 400, unit: px, dpi: 96}
layers:
  - {id: bg, type: rect, z: 0, x: 0, y: 0, width: 400, height: 400, fill: {type: solid, color: '#101418'}}
  - {id: take, type: video, z: 1, x: 0, y: 0, width: 400, height: 400, src: assets/video/absent.mp4, in: 0, video: {offset_ms: 0, duration_ms: 4000}}
`;

test.beforeEach(() => fs.writeFileSync(SCRATCH, DESIGN));
test.afterEach(() => fs.rmSync(SCRATCH, { force: true }));

/** The file span a block's label names, in seconds: "file 1.0–4.0s" → [1, 4]. */
const fileSpan = async (page: import('@playwright/test').Page, id: string): Promise<number[]> => {
  const label = await page.locator(`.tl-clip[data-layer-id="${id}"] .tl-clip-label`).textContent() ?? '';
  return (label.match(/[\d.]+/g) ?? []).map(Number);
};

test('a clip splits at the playhead and trims by its grip', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(EDITOR_PATH)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="take"]')), undefined, { timeout: 45_000 });
  await page.click('[data-tab="timeline"]');

  const blocks = page.locator('.tl-clip');
  await expect(blocks, 'a video layer has no clip block on the timeline').toHaveCount(1);
  expect(await fileSpan(page, 'take')).toEqual([0, 4]);

  // Playhead to the middle of the scene, then ✂ Split with nothing selected:
  // it cuts the clip under the playhead.
  const scrub = page.locator('.tl-scrub-area');
  const box = await scrub.boundingBox();
  if (!box) throw new Error('no scrubber');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.click('#tl-split');

  await expect(blocks, '✂ Split did not cut the clip under the playhead in two').toHaveCount(2);
  const [a0, a1] = await fileSpan(page, 'take');
  const [b0, b1] = await fileSpan(page, 'take_2');
  expect(a0).toBe(0);
  expect(b1).toBe(4);
  expect(a1, 'the halves do not meet where the cut was made').toBeCloseTo(b0 ?? -1, 1);
  expect(a1).toBeGreaterThan(0.5);
  expect(a1).toBeLessThan(3.5);

  // Drag the second half's end grip a fifth of the track to the left: its file span ends earlier.
  const grip = page.locator('.tl-clip[data-layer-id="take_2"] .tl-clip-h[data-edge="end"]');
  const g = await grip.boundingBox();
  const area = await page.locator('.tl-track-area').first().boundingBox();
  if (!g || !area) throw new Error('no grip');
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x - area.width / 10, g.y + g.height / 2, { steps: 6 });
  await page.mouse.move(g.x - area.width / 5, g.y + g.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await fileSpan(page, 'take_2'))[1], { timeout: 10_000, message: 'dragging the end grip did not trim the clip' })
    .toBeLessThan(3.6);
  expect((await fileSpan(page, 'take_2'))[0], 'trimming the end moved the start').toBeCloseTo(b0 ?? -1, 1);
});
