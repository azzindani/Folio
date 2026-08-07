import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// One-handed reach on a phone. Held in one hand, the thumb pivots near the
// bottom corner and sweeps a quarter annulus through the MIDDLE of the screen;
// the top bar is outside it. These check that the reach layer actually puts
// the toolbar's actions inside that sweep, and that it costs the canvas nothing.

const DESIGN = `
meta: { name: One Hand, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#0f2233" }
  - { id: a, type: rect, x: 100, y: 200, width: 300, height: 200, fill: "#1b6b4a" }
`;

const W = 390, H = 844;

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.evaluate(y => (window as any).__folio.loadFromYAML(y), DESIGN);
  await page.waitForTimeout(600);
}

const boxOf = (page: Page, sel: string): Promise<{ x: number; y: number; w: number; h: number } | null> =>
  page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);

test.use({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });

test.describe('one-handed reach layer', () => {
  test('the anchor sits in the middle band, not the unreachable corners', async ({ page }) => {
    await openEditor(page);
    const b = await boxOf(page, '.oh-fab');
    expect(b, 'the anchor should exist on a phone').not.toBeNull();
    const cy = b!.y + b!.h / 2;
    // Comfortably below the toolbar and above the nav — the thumb's rest zone.
    expect(cy).toBeGreaterThan(H * 0.35);
    expect(cy).toBeLessThan(H * 0.8);
    expect(b!.w).toBeGreaterThanOrEqual(44);
  });

  test('every action lands inside the thumb sweep when opened', async ({ page }) => {
    await openEditor(page);
    await page.locator('.oh-fab').tap();
    await page.waitForTimeout(300);
    const items = await page.$$eval('.oh-arc .oh-item', els => els.map(e => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, op: Number(getComputedStyle(e).opacity) };
    }));
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const it of items) {
      expect(it.op, 'items must be visible once open').toBeGreaterThan(0.5);
      expect(it.w, 'touch target').toBeGreaterThanOrEqual(44);
      expect(it.h).toBeGreaterThanOrEqual(44);
      // On-screen…
      expect(it.x).toBeGreaterThanOrEqual(0);
      expect(it.x + it.w).toBeLessThanOrEqual(W);
      expect(it.y).toBeGreaterThanOrEqual(0);
      expect(it.y + it.h).toBeLessThanOrEqual(H);
      // …and out of the top band, which is the whole point.
      expect(it.y, 'nothing may sit in the unreachable top of the screen').toBeGreaterThan(H * 0.2);
    }
  });

  test('the arc is inert until opened, so it cannot swallow canvas taps', async ({ page }) => {
    await openEditor(page);
    // The layer is code-split, so the buttons appear a tick after the design
    // does. Polling rather than sampling once: an empty list would make the
    // `every()` below vacuously true, which is a test that cannot fail.
    await expect.poll(async () => page.evaluate(() => {
      const items = [...document.querySelectorAll('.oh-arc .oh-item')];
      if (!items.length) return null;
      return items.every(e => getComputedStyle(e).pointerEvents === 'none'
        && getComputedStyle(e).visibility === 'hidden');
    }), { timeout: 5000 }).toBe(true);
    await expect(page.locator('.oh-arc')).not.toHaveClass(/\bopen\b/);
  });

  test('an action fires the real toolbar control, not a copy of it', async ({ page }) => {
    await openEditor(page);
    // Give undo something to undo.
    await page.evaluate(() => {
      const st = (window as any).__folio.state;
      st.updateLayer('a', { x: 555 });
    });
    await page.waitForTimeout(200);
    const moved = await page.evaluate(() => (window as any).__folio.state.getCurrentLayers().find((l: any) => l.id === 'a').x);
    expect(moved).toBe(555);

    await page.locator('.oh-fab').tap();
    await page.waitForTimeout(250);
    await page.locator('.oh-item[data-sel="[data-action=\\"undo\\"]"]').tap();
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => (window as any).__folio.state.getCurrentLayers().find((l: any) => l.id === 'a').x);
    expect(back, 'undo through the reach layer must move the real state').not.toBe(555);
  });

  test('opening the layer does not resize the canvas', async ({ page }) => {
    await openEditor(page);
    const before = await boxOf(page, '.canvas-area');
    await page.locator('.oh-fab').tap();
    await page.waitForTimeout(300);
    const after = await boxOf(page, '.canvas-area');
    expect(after).toEqual(before);
  });

  test('dragging it to the left edge sticks, and the arc mirrors', async ({ page }) => {
    await openEditor(page);
    const b = (await boxOf(page, '.oh-fab'))!;
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
    await page.mouse.down();
    await page.mouse.move(40, b.y + b.h / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = (await boxOf(page, '.oh-fab'))!;
    expect(moved.x, 'it should snap to the left edge').toBeLessThan(W / 3);

    await page.locator('.oh-fab').tap();
    await page.waitForTimeout(300);
    const items = await page.$$eval('.oh-arc .oh-item', els => els.map(e => e.getBoundingClientRect().x));
    // Mirrored: the fan now opens to the RIGHT of the anchor.
    expect(Math.max(...items)).toBeGreaterThan(moved.x);
    for (const x of items) expect(x).toBeGreaterThanOrEqual(0);
  });

  test('it steps aside while a sheet is open', async ({ page }) => {
    await openEditor(page);
    await page.locator('.mob-nav-btn[data-mob="layers"]').tap();
    await page.waitForTimeout(500);
    const vis = await page.evaluate(() => {
      const f = document.querySelector('.oh-fab');
      return f ? getComputedStyle(f).display !== 'none' : false;
    });
    expect(vis, 'the anchor must not float over a sheet you just opened').toBe(false);
  });

  test('it is desktop-invisible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    const shown = await page.evaluate(() => {
      const f = document.querySelector('.oh-fab');
      return f ? getComputedStyle(f).display !== 'none' : false;
    });
    expect(shown).toBe(false);
  });
});
