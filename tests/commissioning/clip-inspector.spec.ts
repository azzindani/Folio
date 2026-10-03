import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { FIXTURE_PROJECTS, TEST_TOKEN, scrubBox } from './lib/harness';

/**
 * THE CLIP INSPECTOR — what a person does to footage by hand, in a real browser on real footage.
 *
 * Speed, the join between two clips, the dip colour the preview paints, a screen colour picked out of the
 * picture itself, and the shots and silences the server reads off the file. The arithmetic is unit-tested
 * (animation/clip-edit.ts, ui/panels/properties-clip*.ts); this proves the controls, the canvas and the
 * server route join up on a file ffmpeg wrote — the one place a browser's <video> and real sound matter.
 *
 * The footage is 6 s: three seconds of one picture, a hard cut to another, and a quiet stretch from 1 s to
 * 3 s in its sound. Without ffmpeg the spec is skipped.
 */
const PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
const CLIP = path.join(PROJECT, 'assets', 'video', '_scratch-insp.webm');
const SCRATCH = path.join(PROJECT, 'designs', '_scratch-insp.design.yaml');
const EDITOR_PATH = '/home/folio/projects/commissioning/designs/_scratch-insp.design.yaml';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

const clip = (id: string, from: number): string =>
  `  - {id: ${id}, type: video, z: 1, x: 0, y: 0, width: 320, height: 180, src: assets/video/_scratch-insp.webm, in: ${from}, out: ${from + 3000}, video: {offset_ms: ${from}, duration_ms: 3000}}`;
const DESIGN = `_protocol: design/v1
_mode: complete
meta: {id: commissioning-insp, name: Inspector, type: poster, created: '2026-10-03', modified: '2026-10-03', generator: test-fixture}
document: {width: 320, height: 180, unit: px, dpi: 96}
layers:
  - {id: bg, type: rect, z: 0, x: 0, y: 0, width: 320, height: 180, fill: {type: solid, color: '#101418'}}
${clip('one', 0)}
${clip('two', 3000)}
  - {id: whole, type: video, z: 1, x: 0, y: 0, width: 320, height: 180, src: assets/video/_scratch-insp.webm, in: 6000, out: 12000, video: {offset_ms: 0, duration_ms: 6000}}
`;

test.skip(!hasFfmpeg, 'ffmpeg is needed to make the footage');
test.beforeAll(() => {
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=3', '-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=15:duration=3',
    '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*440*t)*(lt(t\\,1)+gt(t\\,3)):d=6:s=48000', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', '-y', CLIP], { timeout: 60_000 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
});
test.afterAll(() => { fs.rmSync(CLIP, { force: true }); });
test.beforeEach(() => fs.writeFileSync(SCRATCH, DESIGN));
test.afterEach(() => fs.rmSync(SCRATCH, { force: true }));

type Folio = { __folio: { state: { findLayer(id: string): { video?: Record<string, unknown> } | undefined } } };
const videoOf = (page: Page, id: string): Promise<Record<string, unknown>> => page.evaluate(i => (window as unknown as Folio).__folio.state.findLayer(i)?.video ?? {}, id);
const open = async (page: Page): Promise<void> => {
  await page.goto(`/?file=${encodeURIComponent(EDITOR_PATH)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="two"]')), undefined, { timeout: 45_000 });
};
const tab = async (page: Page, name: string): Promise<void> => { await page.click(`button.rpanel-tab[data-tab="${name}"]`); };
const section = async (page: Page, title: string): Promise<string> => {
  const sel = `[data-clip-block="${title}"]`;
  await page.waitForSelector(sel, { state: 'attached' });
  if (await page.locator(sel).evaluate(e => e.classList.contains('collapsed'))) await page.click(`${sel} .prop-section-header`);
  return sel;
};

test('speed, a join with a dip, and a screen colour picked from the picture', async ({ page }) => {
  await open(page);
  await page.click('.layer-row[data-layer-id="two"]');

  // A typed speed goes through the engine's rules onto the clip, and the timeline block says so.
  await page.fill('[data-clip="speed"]', '2');
  await page.locator('[data-clip="speed"]').press('Enter');
  await expect.poll(async () => (await videoOf(page, 'two'))['speed'], { message: 'a typed speed never reached the clip' }).toBe(2);
  await tab(page, 'timeline');
  await expect(page.locator('.tl-clip[data-layer-id="two"] .tl-clip-label')).toContainText('at 2×');

  // The join between the clips carries a marker; a click gives the hard cut a crossfade and opens its section.
  await page.locator('.tl-join[data-layer-id="two"]').click();
  const tx = await section(page, 'Transition');
  await expect(page.locator(`${tx} [data-clip="type"]`)).toHaveValue('crossfade');
  await page.selectOption(`${tx} [data-clip="type"]`, 'dip');
  await page.locator(`${tx} [data-clip="color"]`).evaluate((el: HTMLInputElement) => { el.value = '#ff3366'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  expect((await videoOf(page, 'two'))['transition']).toMatchObject({ type: 'dip', color: '#ff3366' });

  // At the cut the preview paints the dip colour behind both clips; away from it, nothing.
  await tab(page, 'timeline');
  const scrub = await scrubBox(page);
  await page.mouse.click(scrub.x + scrub.width * (3000 / 12000), scrub.y + scrub.height / 2);
  await expect(page.locator('rect[data-dip-for]'), 'the dip colour was not drawn at the cut').toHaveCount(1);
  expect(await page.locator('rect[data-dip-for]').getAttribute('fill')).toBe('#ff3366');
  await page.mouse.click(scrub.x + scrub.width * 0.6, scrub.y + scrub.height / 2);
  await expect(page.locator('rect[data-dip-for]'), 'the dip colour stayed after the window').toHaveCount(0);

  // Green screen: a click on the picture hands back the colour of the file's own frame.
  await page.mouse.click(scrub.x + scrub.width * (3500 / 12000), scrub.y + scrub.height / 2);   // inside "two": a clip is only on the canvas while it plays
  await tab(page, 'properties');
  await page.click('.layer-row[data-layer-id="two"]');
  const key = await section(page, 'Green screen');
  await page.waitForFunction(() => { const v = document.querySelector('video[data-video-layer="two"]') as HTMLVideoElement | null; return !!v && v.readyState >= 2 && v.videoWidth > 0; }, undefined, { timeout: 30_000 });
  await page.click(`${key} [data-clip-act="pick"]`);
  // The minimap draws every clip too; the click belongs to the one on the canvas.
  const box = await page.locator('.canvas-svg-container video[data-video-layer="two"]').boundingBox();
  if (!box) throw new Error('no video on the canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => String(((await videoOf(page, 'two'))['key'] as { color?: string } | undefined)?.color ?? ''), { message: 'the picked colour never reached the clip' }).toMatch(/^#[0-9a-f]{6}$/i);
});

test('the server reads the shots and the silences, and the clip splits at its shots', async ({ page }) => {
  await open(page);
  await page.click('.layer-row[data-layer-id="whole"]');
  const cut = await section(page, 'Cut');
  await page.click(`${cut} [data-clip-act="measure"]`);
  // "whole" plays all 6 s of the file: one hard cut (at 3 s) and one quiet stretch (1–3 s).
  await expect(page.locator(cut), 'the server did not measure the footage').toContainText('1 shot cut · 1 silence', { timeout: 60_000 });
  await expect(page.locator(`${cut} [data-clip-act="silence"]`)).toContainText('Cut 1 silence');
  await tab(page, 'timeline');
  await expect(page.locator('.tl-clip[data-layer-id="whole"] .tl-shot'), 'the shot cut left no tick on the clip').toHaveCount(1);

  // Split at shots: the clip becomes two, meeting where the picture changes (file 3 s = scene 9 s).
  await tab(page, 'properties');
  await page.click('.layer-row[data-layer-id="whole"]');
  await page.click(`${await section(page, 'Cut')} [data-clip-act="split"]`);
  await expect(page.locator('.layer-row[data-layer-id="whole_2"]')).toHaveCount(1);
  const outs = await page.evaluate(() => { const st = (window as unknown as { __folio: { state: { findLayer(id: string): { in?: number; out?: number } | undefined } } }).__folio.state; return [st.findLayer('whole')?.out, st.findLayer('whole_2')?.in]; });
  expect(Math.abs((outs[0] ?? 0) - 9000)).toBeLessThan(60);
  expect(outs[0]).toBe(outs[1]);

  // One undo puts it back together.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row[data-layer-id="whole_2"]')).toHaveCount(0);
});
