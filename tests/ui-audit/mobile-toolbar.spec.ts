import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression guard: nothing in the toolbar may be cropped or pushed off the
// right edge on a phone. Under 1024px the secondary controls (mode switch, New,
// Add Page, Catalog, theme) live in the ⋯ sheet — so they are checked there,
// fully visible, rather than allowed to vanish.

const STRIP = ['.export-group', '[data-action="undo"]', '[data-action="redo"]', '.toolbar-more'];
const SHEET = ['.mode-toggle', '[data-action="new-design"]', '[data-action="add-page"]',
  '.toolbar-catalog-btn', '.toolbar-theme-select'];

for (const vp of [{ name: 'iphone', w: 390, h: 844 }, { name: 'android-sm', w: 360, h: 640 }]) {
  test(`toolbar keeps every control on-screen at ${vp.name} (${vp.w}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
    await page.waitForTimeout(300);

    const within = async (sel: string) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return { found: false, ok: false };
      const r = el.getBoundingClientRect();
      return { found: true, ok: r.right <= window.innerWidth + 0.5 && r.left >= -0.5 && r.width > 0 && r.height > 0 };
    }, sel);

    for (const sel of STRIP) {
      const r = await within(sel);
      expect(r.found, `${sel} present`).toBe(true);
      expect(r.ok, `${sel} fully on-screen at ${vp.w}px`).toBe(true);
    }

    // The strip fits on ONE row: wrapping to a second is what cost ~46px of
    // canvas and is the reason the overflow sheet exists.
    const rows = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar') as HTMLElement;
      return Math.round(tb.getBoundingClientRect().height);
    });
    expect(rows, 'toolbar stays a single row').toBeLessThanOrEqual(64);

    // Everything else is one tap away and fully visible once it is.
    await page.locator('.toolbar-more').click();
    await page.waitForTimeout(250);
    for (const sel of SHEET) {
      const r = await within(`.toolbar-more-menu ${sel}`);
      expect(r.found, `${sel} present in the ⋯ sheet`).toBe(true);
      expect(r.ok, `${sel} fully on-screen at ${vp.w}px`).toBe(true);
    }

    // No element may overflow the viewport width (no horizontal crop/scroll).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
  });
}
