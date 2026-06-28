import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression guard: the New/Add Page toolbar buttons must not push the
// Visual/Payload toggle or the undo/redo/Export cluster off the (clipped)
// right edge on phones. The toolbar collapses to icon-only and wraps.

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

    // The primary CTA, the view toggle, and undo must all be fully visible.
    for (const sel of ['.export-group', '.mode-toggle', '[data-action="undo"]', '[data-action="new-design"]', '[data-action="add-page"]']) {
      const r = await within(sel);
      expect(r.found, `${sel} present`).toBe(true);
      expect(r.ok, `${sel} fully on-screen at ${vp.w}px`).toBe(true);
    }

    // No element may overflow the viewport width (no horizontal crop/scroll).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
  });
}
