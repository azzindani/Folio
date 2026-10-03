import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { FIXTURE_PROJECTS, TEST_TOKEN, scrubBox } from './lib/harness';

/**
 * THE SEQUENCE EDITOR — the timeline as a dock under the canvas (desktop, tablet) and a sheet (phone).
 *
 * What only a browser shows: the dock opens for footage and holds the one timeline, the ruler follows the zoom,
 * a drag on it carries the playhead, a row's name selects its layer, Shift+T and the close button hide it, and
 * the dock's top edge resizes it. On a phone there is no dock — the nav's Timeline slot opens the sheet.
 * The footage is a 6 s WebM made with ffmpeg and removed after; without ffmpeg the spec is skipped.
 */
const PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
const CLIP = path.join(PROJECT, 'assets', 'video', '_scratch-seq.webm');
const SCRATCH = path.join(PROJECT, 'designs', '_scratch-seq.design.yaml');
const EDITOR_PATH = '/home/folio/projects/commissioning/designs/_scratch-seq.design.yaml';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;

const clip = (id: string, at: number): string =>
  `  - {id: ${id}, type: video, z: 1, x: 0, y: 0, width: 320, height: 180, src: assets/video/_scratch-seq.webm, in: ${at}, out: ${at + 3000}, video: {offset_ms: ${at}, duration_ms: 3000}}`;
const DESIGN = `_protocol: design/v1
_mode: complete
meta: {id: commissioning-seq, name: Sequence, type: poster, created: '2026-10-03', modified: '2026-10-03', generator: test-fixture}
document: {width: 320, height: 180, unit: px, dpi: 96}
layers:
  - {id: bg, type: rect, z: 0, x: 0, y: 0, width: 320, height: 180, fill: {type: solid, color: '#101418'}}
${clip('one', 0)}
${clip('two', 3000)}
`;

test.skip(!hasFfmpeg, 'ffmpeg is needed to make the footage');
test.beforeAll(() => {
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6',
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', '-y', CLIP], { timeout: 60_000 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
});
test.afterAll(() => { fs.rmSync(CLIP, { force: true }); });
test.beforeEach(() => fs.writeFileSync(SCRATCH, DESIGN));
test.afterEach(() => fs.rmSync(SCRATCH, { force: true }));

const open = async (page: Page): Promise<void> => {
  await page.goto(`/?file=${encodeURIComponent(EDITOR_PATH)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="two"]')), undefined, { timeout: 45_000 });
};
// One JS turn resolves AND measures: a locator resolves first, and the panel replaces its sheet as thumbnails land — a node
// replaced in between measures 0.
const sheetWidth = (page: Page): Promise<number> => page.evaluate(() => Math.round(document.querySelector('.tl-sheet')?.getBoundingClientRect().width ?? 0));
type Folio = { __folio: { state: { get(): { selectedLayerIds: string[] } } } };

test.describe('desktop', () => {
  test('the dock opens for footage and holds a zoomable, scrubbable, selectable sequence', async ({ page }) => {
    await open(page);
    const dock = page.locator('#timeline-dock');
    await expect(dock, 'a design with footage did not open the timeline dock').toBeVisible();
    await expect(dock.locator('.tl-sheet')).toHaveCount(1);
    expect(await dock.locator('.tl-ruler-row .tl-tick-label').count(), 'the ruler has no marks').toBeGreaterThan(1);

    // Zoom: the sheet outgrows the view and scrolls; Fit puts it back.
    // The view the sheet fits is the scroller's own width; the layout settles (grid transition, the scene length
    // arriving from the sampler) a moment after the dock opens, so measure against it, not against an early read.
    const view = (): Promise<number> => page.locator('#tl-body').evaluate(e => e.clientWidth);
    await expect.poll(async () => Math.abs((await sheetWidth(page)) - (await view())), { message: 'the sheet does not fit the view at first' }).toBeLessThanOrEqual(1);
    for (let i = 0; i < 3; i++) await page.click('#tl-zoom-in');
    await expect.poll(async () => (await sheetWidth(page)) > (await view()) * 2, { message: '+ did not widen the sheet' }).toBe(true);
    expect(await page.locator('#tl-body').evaluate(e => e.scrollWidth > e.clientWidth), 'a zoomed sheet does not scroll').toBe(true);
    await page.click('#tl-zoom-fit');
    await expect.poll(async () => Math.abs((await sheetWidth(page)) - (await view())), { message: 'Fit did not bring the sheet back to the view' }).toBeLessThanOrEqual(1);

    // A drag on the ruler carries the playhead.
    const ruler = await scrubBox(page);
    await page.mouse.move(ruler.x + ruler.width * 0.25, ruler.y + 10);
    await page.mouse.down();
    await page.mouse.move(ruler.x + ruler.width * 0.75, ruler.y + 10, { steps: 8 });
    await page.mouse.up();
    const head = Number(await page.locator('.tl-sheet').evaluate(e => (e as HTMLElement).style.getPropertyValue('--tl-p')));
    expect(head, 'the playhead did not follow the drag').toBeGreaterThan(0.7);
    expect(head).toBeLessThan(0.8);

    // A row's name selects its layer; the inspector follows.
    await page.click('.tl-label[data-layer-id="two"]');
    expect(await page.evaluate(() => (window as unknown as Folio).__folio.state.get().selectedLayerIds)).toEqual(['two']);
    await expect(page.locator('[data-clip-block="Clip"]')).toHaveCount(1);
    await expect(page.locator('.tl-label.tl-selected')).toHaveCount(1);
    expect(await page.locator('.tl-track').count(), 'selecting a layer removed the other rows').toBeGreaterThanOrEqual(2);
  });

  test('Shift+T, the close button and the status button hide and show it; its top edge resizes it', async ({ page }) => {
    await open(page);
    const dock = page.locator('#timeline-dock');
    await expect(dock).toBeVisible();
    await page.locator('body').press('Shift+T');
    await expect(dock).toBeHidden();
    await page.click('#status-timeline');
    await expect(dock).toBeVisible();
    await page.click('#timeline-dock-close');
    await expect(dock).toBeHidden();
    await page.click('[data-tab="timeline"]');
    await expect(dock, 'the rail\'s clock tab did not bring the timeline back').toBeVisible();
    await page.click('[data-tab="timeline"]');
    await expect(dock, 'a second press on the clock tab closed it').toBeVisible();

    const h0 = (await dock.boundingBox())?.height ?? 0;
    const handle = await dock.locator('.panel-resize-handle').boundingBox();
    if (!handle) throw new Error('no resize handle');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 100, { steps: 6 });
    await page.mouse.up();
    expect((await dock.boundingBox())?.height ?? 0, 'dragging the top edge did not grow the dock').toBeGreaterThan(h0 + 60);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  test('the dock is there, under the canvas, and the sheet fits the screen', async ({ page }) => {
    await open(page);
    const dock = page.locator('#timeline-dock');
    await expect(dock).toBeVisible();
    expect(await sheetWidth(page)).toBeLessThanOrEqual(820);
    const canvas = await page.locator('.canvas-svg-container').boundingBox();
    const d = await dock.boundingBox();
    expect(canvas && d && d.y >= canvas.y + canvas.height - 2, 'the dock is not below the canvas').toBe(true);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('no dock: the nav\'s Timeline slot opens the timeline as a sheet, and a pinch zooms it', async ({ page }) => {
    await open(page);
    await expect(page.locator('#timeline-dock')).toBeHidden();
    await page.locator('.mob-nav-btn[data-mob="timeline"]').tap();
    await expect(page.locator('.properties-panel.mob-open .tl-sheet')).toBeVisible();
    const view = (): Promise<number> => page.locator('#tl-body').evaluate(e => e.clientWidth);
    await expect.poll(async () => Math.abs((await sheetWidth(page)) - (await view())), { message: 'the sheet does not fit the sheet at first' }).toBeLessThanOrEqual(1);
    expect(await sheetWidth(page)).toBeLessThanOrEqual(390);
    await page.tap('#tl-zoom-in');
    await page.tap('#tl-zoom-in');
    expect(await sheetWidth(page), 'the zoom buttons did not widen the sheet on a phone').toBeGreaterThan((await view()) * 1.5);
    await page.locator('.mob-nav-btn[data-mob="timeline"]').tap();
    await expect(page.locator('.properties-panel.mob-open')).toHaveCount(0);
  });
});
