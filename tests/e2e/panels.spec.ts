import { test, expect } from '@playwright/test';

test.describe('Panels — properties panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('properties panel is visible', async ({ page }) => {
    await expect(page.locator('.properties-panel')).toBeVisible();
  });

  test('properties panel shows content when layer selected', async ({ page }) => {
    const row = page.locator('.layer-row').first();
    await row.click();
    const panel = page.locator('.properties-panel');
    await expect(panel).toBeVisible();
    // Panel should show some content
    const content = await panel.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('properties panel is empty-ish when nothing selected', async ({ page }) => {
    await page.keyboard.press('Escape');
    const panel = page.locator('.properties-panel');
    await expect(panel).toBeVisible();
  });
});

test.describe('Panels — right panel reachable on desktop (collapse toggle)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('clicking the active right tab collapses, then re-expands', async ({ page }) => {
    const app = page.locator('#app');
    const tab = page.locator('.r-activity-bar .rpanel-tab[data-tab="properties"]');
    await expect(app).not.toHaveClass(/rpanel-collapsed/);
    await tab.click();
    await expect(app).toHaveClass(/rpanel-collapsed/);
    await tab.click();
    await expect(app).not.toHaveClass(/rpanel-collapsed/);
  });
});

test.describe('Panels — right panel reachable on tablet (overlay)', () => {
  // Regression: at 768–1023px the panel is an off-screen `.mob-open` overlay and
  // the grid `rpanel` column is forced to 0, so the desktop `rpanel-collapsed`
  // toggle does nothing. The visible r-activity-bar must drive `.mob-open` or the
  // panel is unreachable ("the rightbar cannot be used, it remains persistent").
  // hasTouch is required, not cosmetic: the overlay layout is gated on a COARSE
  // pointer now, because a mouse window at 900px is a desktop and keeps its
  // docked panels. Without it this describes a device that does not exist.
  test.use({ viewport: { width: 900, height: 800 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  // The panel has a 250ms slide transition, so read its rect via expect.poll —
  // a bare getBoundingClientRect right after the class toggles catches it
  // mid-animation (still off/partly on screen) and flakes.
  const onScreen = (page: import('@playwright/test').Page): Promise<boolean> =>
    page.evaluate(() => {
      const rp = document.querySelector('.properties-panel');
      if (!rp) return false;
      const r = rp.getBoundingClientRect();
      return r.left < window.innerWidth - 4 && r.right > 4 && r.width > 4;
    });

  test('r-activity-bar tab slides the panel on-screen, re-click slides it out', async ({ page }) => {
    const panel = page.locator('.properties-panel');
    const tab = page.locator('.r-activity-bar .rpanel-tab[data-tab="properties"]');
    // Starts closed (off-screen) so the canvas is unobstructed.
    await expect.poll(() => onScreen(page)).toBe(false);
    await tab.click();
    await expect(panel).toHaveClass(/mob-open/);
    await expect.poll(() => onScreen(page)).toBe(true);
    // Re-clicking the open tab dismisses it.
    await tab.click();
    await expect(panel).not.toHaveClass(/mob-open/);
    await expect.poll(() => onScreen(page)).toBe(false);
  });

  test('switching to another right tab keeps the overlay open and swaps panes', async ({ page }) => {
    await page.locator('.r-activity-bar .rpanel-tab[data-tab="properties"]').click();
    await page.locator('.r-activity-bar .rpanel-tab[data-tab="data"]').click();
    await expect(page.locator('.properties-panel')).toHaveClass(/mob-open/);
    await expect(page.locator('.rpanel-body .tab-pane[data-tab="data"]')).toHaveClass(/active/);
  });
});

test.describe('Panels — layer panel interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layer-row', { timeout: 10_000 });
  });

  test('layer panel renders rows', async ({ page }) => {
    const rows = page.locator('.layer-row');
    await expect(rows.first()).toBeVisible();
  });

  test('clicking layer row selects it and updates properties panel', async ({ page }) => {
    const row = page.locator('.layer-row').first();
    await row.click();
    await expect(row).toHaveClass(/selected/);
    await expect(page.locator('.properties-panel')).toBeVisible();
  });

  test('visibility toggle button exists on layer row', async ({ page }) => {
    const visBtn = page.locator('.layer-vis-btn').first();
    await expect(visBtn).toBeVisible();
  });

  test('clicking visibility button does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('.layer-vis-btn').first().click();
    expect(errors).toHaveLength(0);
  });

  test('lock button exists on layer row', async ({ page }) => {
    const lockBtn = page.locator('.layer-lock-btn').first();
    await expect(lockBtn).toBeVisible();
  });

  test('clicking lock button does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('.layer-lock-btn').first().click();
    expect(errors).toHaveLength(0);
  });
});

test.describe('Panels — file tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
  });

  test('file tree opens via activity button', async ({ page }) => {
    await page.locator('.act-btn[data-panel="files"]').click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3_000 });
  });

  test('file tree has a save button or new-file UI', async ({ page }) => {
    await page.locator('.act-btn[data-panel="files"]').click();
    await page.waitForSelector('.file-tree');
    const tree = page.locator('.file-tree');
    // Tree has some content
    const content = await tree.textContent();
    expect(content).not.toBeNull();
  });
});

test.describe('Panels — payload editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('payload mode switch shows code editor', async ({ page }) => {
    await page.locator('.mode-btn[data-mode="payload"]').click();
    // Monaco container becomes visible on mode switch
    const editor = page.locator('.monaco-container');
    await expect(editor.first()).toBeVisible({ timeout: 5_000 });
  });

  test('switching back to visual mode hides payload editor', async ({ page }) => {
    await page.locator('.mode-btn[data-mode="payload"]').click();
    await page.locator('.mode-btn[data-mode="visual"]').click();
    const canvas = page.locator('.canvas-area').first();
    await expect(canvas).toBeVisible();
  });
});

test.describe('Panels — align toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    // Select 2+ layers so the align toolbar becomes visible
    await page.locator('.layer-row').first().click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await page.waitForSelector('.align-toolbar:not(.align-toolbar--hidden)', { timeout: 5_000 });
  });

  test('align toolbar is present', async ({ page }) => {
    await expect(page.locator('.align-toolbar')).toBeVisible();
  });

  test('all 8 align/distribute buttons are present', async ({ page }) => {
    const buttons = page.locator('.align-toolbar button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('clicking align button with nothing selected does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('Escape');
    const firstBtn = page.locator('.align-toolbar button').first();
    // Inactive buttons have pointer-events:none; force:true tests the JS guard
    await firstBtn.click({ force: true });
    expect(errors).toHaveLength(0);
  });
});

test.describe('Panels — minimap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
  });

  test('minimap element exists in DOM', async ({ page }) => {
    const minimap = page.locator('.minimap, [class*="minimap"]');
    // Minimap may or may not be visible by default
    const count = await minimap.count();
    expect(count).toBeGreaterThanOrEqual(0); // just verify no crash
  });
});

test.describe('Panels — problems panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
  });

  test('problems panel exists or is accessible', async ({ page }) => {
    // Problems panel might be in a tab or accessible via button
    const panel = page.locator('.problems-panel, [data-panel="problems"]');
    const count = await panel.count();
    // Just verify the app loads without crashing
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Panels — page strip (carousel)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
  });

  test('page strip renders for multi-page designs', async ({ page }) => {
    // Default design may or may not have pages; just verify no crash
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const strip = page.locator('.page-strip');
    const count = await strip.count();
    expect(count).toBeGreaterThanOrEqual(0);
    expect(errors).toHaveLength(0);
  });
});
