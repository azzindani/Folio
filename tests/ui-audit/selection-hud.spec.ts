import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Options belong beside the object they act on. On a phone every command used
// to live at the bottom of the screen: select something at the top, reach to
// the bottom, act, look back up. These check the verbs actually arrive next to
// the selection, that they get out of the way of the canvas, and that the
// bottom sheets are still there for the things that belong in a sheet.

const DESIGN = `
meta: { name: HUD Test, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#0f2233" }
  - { id: a, type: rect, x: 120, y: 160, width: 360, height: 240, fill: "#1b6b4a" }
  - { id: b, type: rect, x: 120, y: 1050, width: 360, height: 200, fill: "#b4513a" }
  - { id: t, type: text, x: 120, y: 520, width: 700, content: "Headline", style: { font_size: 64, color: "#f2e8d5" } }
`;

const W = 390, H = 844;

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.evaluate(y => (window as any).__folio.loadFromYAML(y), DESIGN);
  await page.waitForTimeout(600);
}

async function select(page: Page, ...ids: string[]): Promise<void> {
  await page.evaluate(v => (window as any).__folio.state.set('selectedLayerIds', v), ids);
  await page.waitForTimeout(350);
}

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (page: Page, sel: string): Promise<Box | null> =>
  page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);

/** The union of the canvas's own selection outlines — where the object is. */
const selBox = (page: Page): Promise<Box | null> =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('.selection-box')];
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return { x, y, w: Math.max(...rs.map(r => r.right)) - x, h: Math.max(...rs.map(r => r.bottom)) - y };
  });

test.use({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });

test.describe('selection options on touch', () => {
  test('selecting a layer brings the verbs to it, not to the bottom bar', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    const hud = await boxOf(page, '.sel-hud');
    const sel = await selBox(page);
    expect(hud, 'the bar should appear on selection').not.toBeNull();
    expect(sel).not.toBeNull();

    // Adjacent to the object…
    const gap = hud!.y - (sel!.y + sel!.h);
    expect(gap, `bar should hug the selection, was ${gap}px away`).toBeLessThan(40);
    // …and nowhere near the bottom nav, which is the whole complaint.
    const nav = await boxOf(page, '.mobile-nav');
    expect(hud!.y + hud!.h).toBeLessThan(nav!.y - 100);
  });

  test('it sits BELOW the selection, the side the hand comes from', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    const placement = await page.evaluate(() =>
      document.querySelector('.sel-hud')?.getAttribute('data-placement'));
    expect(placement).toBe('below');
  });

  test('it flips above rather than hiding under the nav bar', async ({ page }) => {
    await openEditor(page);
    await select(page, 'b');   // near the floor of the artboard
    const hud = await boxOf(page, '.sel-hud');
    const nav = await boxOf(page, '.mobile-nav');
    expect(hud!.y + hud!.h).toBeLessThanOrEqual(nav!.y);
    expect(hud!.x).toBeGreaterThanOrEqual(0);
    expect(hud!.x + hud!.w).toBeLessThanOrEqual(W);
  });

  test('it gets out of the way while the canvas is being dragged', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    const sel = (await selBox(page))!;
    await page.mouse.move(sel.x + sel.w / 2, sel.y + sel.h / 2);
    await page.mouse.down();
    await page.mouse.move(sel.x + sel.w / 2 + 40, sel.y + sel.h / 2 + 40, { steps: 4 });
    const during = await page.evaluate(() =>
      document.querySelector('.sel-hud')?.classList.contains('anc-open') ?? false);
    expect(during, 'nothing may float under the finger mid-drag').toBe(false);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() =>
      document.querySelector('.sel-hud')?.classList.contains('anc-open') ?? false);
    expect(after, 'and it must come back when the drag ends').toBe(true);
  });

  test('Edit opens the inspector in place, and only one surface shows at a time', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await page.locator('.sel-hud-btn[data-key="edit"]').tap();
    await page.waitForTimeout(350);
    const open = await page.evaluate(() => ({
      qe: document.querySelector('.quick-edit')?.classList.contains('anc-open') ?? false,
      hud: document.querySelector('.sel-hud')?.classList.contains('anc-open') ?? false,
    }));
    expect(open).toEqual({ qe: true, hud: false });

    const qe = (await boxOf(page, '.quick-edit'))!;
    const nav = (await boxOf(page, '.mobile-nav'))!;
    expect(qe.y + qe.h, 'the inspector is anchored, not a bottom sheet').toBeLessThanOrEqual(nav.y);
  });

  test('a swatch recolours the selection without a trip to the sheet', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await page.locator('.sel-hud-btn[data-key="edit"]').tap();
    await page.waitForTimeout(350);
    // The swatches are the colours already in the design — pick a different one.
    const swatches = await page.$$eval('.qe-swatch[data-color]', els =>
      els.map(e => (e as HTMLElement).dataset['color'] ?? ''));
    const want = swatches.find(c => c !== '#1b6b4a');
    expect(want, `expected other design colours, got ${JSON.stringify(swatches)}`).toBeTruthy();
    await page.locator(`.qe-swatch[data-color="${want}"]`).tap();
    await page.waitForTimeout(250);
    const fill = await page.evaluate(() => {
      const l = (window as any).__folio.state.getCurrentLayers().find((x: any) => x.id === 'a');
      return typeof l.fill === 'string' ? l.fill : l.fill?.color;
    });
    expect(String(fill).toLowerCase()).toBe(want);
  });

  test('the opacity slider drives the real layer', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await page.locator('.sel-hud-btn[data-key="edit"]').tap();
    await page.waitForTimeout(350);
    await page.locator('.qe-opacity input[type="range"]').fill('40');
    await page.waitForTimeout(200);
    const op = await page.evaluate(() =>
      (window as any).__folio.state.getCurrentLayers().find((x: any) => x.id === 'a').opacity);
    expect(op).toBeCloseTo(0.4, 2);
  });

  test('a text selection gets the size stepper; a rectangle does not', async ({ page }) => {
    await openEditor(page);
    await select(page, 't');
    await page.locator('.sel-hud-btn[data-key="edit"]').tap();
    await page.waitForTimeout(350);
    await expect(page.locator('.qe-step[data-delta="2"]')).toBeVisible();
    await page.locator('.qe-step[data-delta="2"]').tap();
    await page.waitForTimeout(200);
    const size = await page.evaluate(() =>
      (window as any).__folio.state.getCurrentLayers().find((x: any) => x.id === 't').style.font_size);
    expect(size).toBe(66);

    await page.locator('.qe-close').tap();
    await select(page, 'a');
    await page.locator('.sel-hud-btn[data-key="edit"]').tap();
    await page.waitForTimeout(350);
    await expect(page.locator('.qe-step')).toHaveCount(0);
  });

  test('"More" opens the SAME full menu the desktop gets, at the object', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await page.locator('.sel-hud-btn[data-key="more"]').tap();
    await page.waitForSelector('.canvas-context-menu', { timeout: 4000 });
    const labels = await page.$$eval('.canvas-context-menu .ccm-item span',
      els => els.map(e => (e.textContent ?? '').trim()));
    for (const want of ['Duplicate', 'Send to back', 'Lock', 'Delete']) {
      expect(labels).toContain(want);
    }
    // Finger-sized rows, and anchored — not a bottom sheet.
    const rows = await page.$$eval('.canvas-context-menu .ccm-item',
      els => els.map(e => e.getBoundingClientRect().height));
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(44);
  });

  test('Group only appears when there is something to group', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await expect(page.locator('.sel-hud-btn[data-key="group"]')).toHaveCount(0);
    await select(page, 'a', 'b');
    await expect(page.locator('.sel-hud-btn[data-key="group"]')).toHaveCount(1);
  });

  test('the bottom sheets are untouched — this is a shorter route, not a swap', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    await page.locator('.mob-nav-btn[data-mob="layers"]').tap();
    await page.waitForTimeout(400);
    await expect(page.locator('.left-panel.mob-open')).toHaveCount(1);
    // …and the anchored surface yields to it rather than floating on top.
    const hud = await page.evaluate(() =>
      document.querySelector('.sel-hud')?.classList.contains('anc-open') ?? false);
    expect(hud).toBe(false);
  });

});

// A real mouse desktop — NOT this file's phone with a wider window, which is a
// touch laptop and should keep the bar. The gate is the pointer, not the width.
test.describe('a mouse desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test('never mounts it — right-click already puts the menu at the cursor', async ({ page }) => {
    await openEditor(page);
    await select(page, 'a');
    expect(await page.locator('.sel-hud').count()).toBe(0);
  });
});
