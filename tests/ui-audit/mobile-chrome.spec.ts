import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression guard for the phone's chrome: everything you press is in the dock
// at the bottom, nothing is cropped, nothing overlaps, and the top bar carries
// the design's name rather than a row of buttons.
//
// A real touchscreen, not just a narrow window — the whole phone layout is
// gated on a coarse pointer, since a narrowed desktop can reach a 28px control.
test.use({ hasTouch: true, isMobile: true });

const DOCK = ['[data-dock-mode="visual"]', '[data-dock-mode="payload"]', '[data-dock-mode="preview"]',
  '[data-dock="undo"]', '[data-dock="redo"]', '[data-dock="export"]', '[data-dock="more"]'];
// What the More sheet holds: the controls a phone needs occasionally.
const SHEET = ['[data-action="new-design"]', '[data-action="add-page"]', '.toolbar-catalog-btn',
  '.toolbar-theme-select', '#zoom-fit', '#status-preview', '#toggle-grid', '#toggle-snap', '#canvas-resize'];

for (const vp of [{ name: 'iphone', w: 390, h: 844 }, { name: 'android-sm', w: 360, h: 640 }]) {
  test(`every control is in the dock and on-screen at ${vp.name} (${vp.w}px)`, async ({ page }) => {
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

    for (const sel of DOCK) {
      const r = await within(sel);
      expect(r.found, `${sel} present in the dock`).toBe(true);
      expect(r.ok, `${sel} fully on-screen at ${vp.w}px`).toBe(true);
    }

    // The old build had a fixed nav bar AND a fixed status bar at the bottom,
    // offset from each other by hand; they overlapped by 13px. One container
    // in normal flow cannot.
    const bars = await page.evaluate(() => {
      const box = (s: string) => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (!el || getComputedStyle(el).display === 'none') return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      return { dock: box('.mobile-dock'), nav: box('.mobile-nav'), status: box('.status-bar') };
    });
    expect(bars.dock, 'the dock is on screen').not.toBeNull();
    expect(bars.status, 'the status bar is folded into the dock').toBeNull();
    expect(bars.nav!.top, 'the nav sits inside the dock').toBeGreaterThanOrEqual(bars.dock!.top);
    expect(bars.nav!.bottom).toBeLessThanOrEqual(bars.dock!.bottom + 1);

    // The top bar is a title, not a toolbar.
    const top = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar') as HTMLElement;
      const pressable = [...tb.querySelectorAll('button, select')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length;
      return { height: Math.round(tb.getBoundingClientRect().height), pressable };
    });
    expect(top.height, 'the title bar stays one slim row').toBeLessThanOrEqual(48);
    expect(top.pressable, 'no buttons in the top bar').toBe(0);

    // Everything else is one tap away and fully visible once it is.
    await page.locator('[data-dock="more"]').click();
    await page.waitForTimeout(250);
    for (const sel of SHEET) {
      const r = await within(`.dock-more ${sel}`);
      expect(r.found, `${sel} present in the More sheet`).toBe(true);
      expect(r.ok, `${sel} fully on-screen at ${vp.w}px`).toBe(true);
    }

    // No element may overflow the viewport width (no horizontal crop/scroll).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
  });
}

test('rulers are off and the payload view is not painted over', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.waitForTimeout(300);

  // A ruler costs 40px of a 390px screen and cannot be read against a finger.
  expect(await page.locator('.ruler-v').count(), 'no rulers on a phone').toBe(0);

  // Straight from the dock — one tap, the way a phone user switches views.
  await page.locator('[data-dock-mode="payload"]').click();
  await page.waitForTimeout(800);
  expect(await page.locator('[data-dock-mode="payload"]').getAttribute('aria-pressed'),
    'the dock shows which view is on').toBe('true');
  const view = await page.evaluate(() => {
    const vis = (s: string) => {
      const el = document.querySelector(s) as HTMLElement | null;
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const monaco = document.querySelector('.monaco-container') as HTMLElement | null;
    const r = monaco?.getBoundingClientRect();
    return {
      mode: document.getElementById('app')?.dataset['mode'],
      canvasPainted: vis('.viewport-pane'),
      stripShown: vis('#page-strip-section'),
      monacoShown: vis('.monaco-container'),
      monacoHeight: Math.round(r?.height ?? 0),
    };
  });
  expect(view.mode).toBe('payload');
  expect(view.monacoShown, 'the YAML editor is visible').toBe(true);
  expect(view.monacoHeight, 'and gets the height').toBeGreaterThan(400);
  expect(view.canvasPainted, 'the canvas stops painting under it').toBe(false);
  expect(view.stripShown, 'and the page strip goes with it').toBe(false);
});

test('one play control is visible, and the status bar ▶ is gone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  // Two pages make a deck, which is what gives the piece something to play —
  // the button is absent on a design with no motion and one page, deliberately.
  await page.evaluate(() => (window as any).__folio.loadFromYAML(`
meta: { name: Deck, type: carousel }
document: { width: 1080, height: 1350, unit: px }
pages:
  - id: one
    label: One
    layers: [{ id: a, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#10243f" }]
  - id: two
    label: Two
    layers: [{ id: b, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#2b4af2" }]
`));
  await page.waitForTimeout(500);

  const chrome = await page.evaluate(() => {
    const shown = (el: Element | null): boolean => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    return {
      // Play + Play all sat side by side as two words for one verb.
      playAll: document.querySelectorAll('.toolbar-play-all').length,
      // One VISIBLE play affordance: the dock's on a phone, the toolbar's on a
      // desktop — never both, never a third.
      visiblePlays: [...document.querySelectorAll('.toolbar-play, [data-dock="play"]')].filter(shown).length,
      // The status bar's ▶ was a third one; it is Present now, and on a phone
      // it lives in the More sheet under that name.
      present: document.querySelector('#status-preview')?.getAttribute('aria-label'),
      presentInDock: !!document.querySelector('.dock-more #status-preview'),
    };
  });
  expect(chrome.playAll, 'no separate "Play all"').toBe(0);
  expect(chrome.visiblePlays, 'exactly one play control on screen').toBe(1);
  expect(chrome.present).toBe('Present full screen');
  expect(chrome.presentInDock).toBe(true);
});
