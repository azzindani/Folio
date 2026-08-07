import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A DESKTOP window narrowed to 900px is still a desktop: mouse, hover,
// keyboard, no thumbs. It was being handed the tablet chrome — panels became
// slide-in overlays and the toolbar collapsed into a ⋯ sheet — purely because
// the viewport got narrow. The touch layout is now gated on a COARSE POINTER
// as well as width, so only an actual touchscreen gets it.

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.waitForTimeout(400);
}

async function layoutProbe(page: Page): Promise<{
  cols: number; navVisible: boolean; overflowVisible: boolean;
  leftPanelOverlay: boolean; toolsPanelVisible: boolean;
}> {
  return await page.evaluate(() => {
    const app = document.getElementById('app') as HTMLElement;
    const vis = (sel: string): boolean => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
    };
    const lp = document.querySelector<HTMLElement>('.left-panel');
    return {
      cols: getComputedStyle(app).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      navVisible: vis('.mobile-nav'),
      overflowVisible: vis('.toolbar-more'),
      // Overlay panels are taken out of flow; a desktop panel is a grid column.
      leftPanelOverlay: lp ? getComputedStyle(lp).position === 'absolute' || getComputedStyle(lp).position === 'fixed' : false,
      toolsPanelVisible: vis('.tools-panel'),
    };
  });
}

test.describe('a narrowed desktop window keeps the desktop layout', () => {
  // No hasTouch: this is a mouse-driven browser, which is the whole point.
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const width of [1440, 1100, 900, 780, 700]) {
    test(`at ${width}px the desktop chrome is intact`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openEditor(page);
      const probe = await layoutProbe(page);
      expect(probe.cols, 'desktop keeps its five-column grid').toBe(5);
      expect(probe.navVisible, 'the phone nav bar must not appear on a mouse device').toBe(false);
      expect(probe.overflowVisible, 'the ⋯ toolbar sheet is a touch affordance').toBe(false);
      expect(probe.leftPanelOverlay, 'panels stay docked, not slide-in overlays').toBe(false);
    });
  }

  test('the tool palette stays in the left panel, not a phone strip', async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 900 });
    await openEditor(page);
    expect((await layoutProbe(page)).toolsPanelVisible).toBe(true);
  });
});

test.describe('an actual touchscreen still gets the touch layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('phone chrome is unchanged by the pointer gate', async ({ page }) => {
    await openEditor(page);
    const probe = await layoutProbe(page);
    expect(probe.navVisible).toBe(true);
    expect(probe.overflowVisible).toBe(true);
  });
});

test.describe('a touch tablet still gets the overlay layout', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('tablet chrome is unchanged by the pointer gate', async ({ page }) => {
    await openEditor(page);
    expect((await layoutProbe(page)).overflowVisible).toBe(true);
  });
});
