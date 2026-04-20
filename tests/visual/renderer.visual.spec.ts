import { test, expect } from '@playwright/test';

/**
 * Visual regression tests — compare screenshots against committed baselines.
 * Run `npm run test:update-snapshots` to update baselines after intentional changes.
 * Tolerance: 1% pixel diff max (maxDiffPixelRatio: 0.01).
 */

test.describe('Visual Regression — renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    // Wait for fonts to settle
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
  });

  test('default sample design renders correctly', async ({ page }) => {
    const canvas = page.locator('.canvas-area').first();
    await expect(canvas).toHaveScreenshot('default-design.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('full editor layout renders correctly', async ({ page }) => {
    await expect(page).toHaveScreenshot('full-editor.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('layer panel renders correctly', async ({ page }) => {
    const panel = page.locator('.layer-panel');
    await expect(panel).toHaveScreenshot('layer-panel.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression — layer selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
  });

  test('selected layer shows handles', async ({ page }) => {
    // Click near top-left of canvas area (stays within the grid cell bounds)
    await page.locator('.canvas-area').first().click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(100);

    const canvas = page.locator('.canvas-area').first();
    await expect(canvas).toHaveScreenshot('selected-layer.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
