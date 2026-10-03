import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { FIXTURE_PROJECTS, TEST_TOKEN } from './lib/harness';

/**
 * THE CLIP TRACK, DRESSED AND KEYED — what only a browser with real footage shows.
 *
 * A clip block carries its footage as thumbnails and its sound as a waveform,
 * both measured in the browser from the file the canvas plays; S cuts the clip
 * under the playhead; Delete takes a clip off its main track and the clips after
 * it close the gap. The arithmetic is unit-tested (ui/panels/timeline-clips.ts,
 * timeline-filmstrip.ts); this proves the keys, the grabs and the redraws join up.
 *
 * Commissioning carries no binary footage: a 4 s WebM (VP8 + Opus — what any
 * Chromium decodes) is made here with ffmpeg and removed after. Without ffmpeg
 * the test is skipped.
 */
const PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
const CLIP = path.join(PROJECT, 'assets', 'video', '_scratch-strip.webm');
const SCRATCH = path.join(PROJECT, 'designs', '_scratch-strip.design.yaml');
const EDITOR_PATH = '/home/folio/projects/commissioning/designs/_scratch-strip.design.yaml';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

const clip = (id: string, at: number): string =>
  `  - {id: ${id}, type: video, z: 1, x: 0, y: 0, width: 400, height: 225, src: assets/video/_scratch-strip.webm, in: ${at}, out: ${at + 2000}, video: {offset_ms: ${at}, duration_ms: 2000}}`;
const DESIGN = `_protocol: design/v1
_mode: complete
meta: {id: commissioning-strip, name: Strip, type: poster, created: '2026-10-03', modified: '2026-10-03', generator: test-fixture}
document: {width: 400, height: 225, unit: px, dpi: 96}
layers:
  - {id: bg, type: rect, z: 0, x: 0, y: 0, width: 400, height: 225, fill: {type: solid, color: '#101418'}}
${clip('one', 0)}
${clip('two', 2000)}
`;

test.skip(!hasFfmpeg, 'ffmpeg is needed to make the footage');
test.beforeAll(() => {
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', '-y', CLIP], { timeout: 60_000 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
});
test.afterAll(() => { fs.rmSync(CLIP, { force: true }); });
test.beforeEach(() => fs.writeFileSync(SCRATCH, DESIGN));
test.afterEach(() => fs.rmSync(SCRATCH, { force: true }));

const leftPct = async (page: import('@playwright/test').Page, id: string): Promise<number> =>
  parseFloat(await page.locator(`.tl-clip[data-layer-id="${id}"]`).evaluate(el => (el as HTMLElement).style.left));

test('clip blocks show their footage and sound; S splits; Delete closes the gap', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(EDITOR_PATH)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="one"]')), undefined, { timeout: 45_000 });
  await page.click('[data-tab="timeline"]');
  await expect(page.locator('.tl-clip'), 'two clips, two blocks').toHaveCount(2);

  // Thumbnails are grabbed from the file and land as images; the sound lands as a waveform.
  await expect.poll(async () => page.locator('.tl-clip[data-layer-id="two"] .tl-clip-strip img').count(),
    { timeout: 30_000, message: 'no thumbnails were grabbed from the clip\'s file' }).toBeGreaterThan(0);
  const src = await page.locator('.tl-clip[data-layer-id="two"] .tl-clip-strip img').first().getAttribute('src');
  expect(src ?? '').toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator('.tl-clip[data-layer-id="one"] .tl-clip-wave'), 'the clip\'s sound drew no waveform').toHaveCount(1, { timeout: 30_000 });

  // Playhead into the second clip, then S: it cuts the clip under the playhead.
  const scrub = await page.locator('.tl-scrub-area').boundingBox();
  if (!scrub) throw new Error('no scrubber');
  await page.mouse.click(scrub.x + scrub.width * 0.75, scrub.y + scrub.height / 2);
  await page.locator('body').press('s');
  await expect(page.locator('.tl-clip'), 'S did not cut the clip under the playhead').toHaveCount(3);

  // Select the first clip and Delete it: the rest of the track moves up to where it began.
  await page.click('.layer-row[data-layer-id="one"]');
  await page.keyboard.press('Delete');
  await expect(page.locator('.tl-clip'), 'Delete left the clip on the track').toHaveCount(2);
  expect(await leftPct(page, 'two'), 'the track did not close the gap the clip left').toBeCloseTo(0, 1);
  expect(await leftPct(page, 'two_2')).toBeGreaterThan(10);
});
