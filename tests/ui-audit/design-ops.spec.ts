import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Design operations added in v0.1.0: New blank design + Add Page from any design.
// Driven through the real toolbar buttons (stable data-action selectors).

async function bootEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
}

test('Add Page converts a single-page design and reveals the page strip', async ({ page }) => {
  await bootEditor(page);
  const strip = page.locator('#page-strip-section');
  await page.locator('[data-action="add-page"]').click();
  await expect(strip).toBeVisible();
  const pages = await page.evaluate(() => (window as any).__folio.state.get().design.pages.length);
  expect(pages).toBe(2);
  const idx = await page.evaluate(() => (window as any).__folio.state.get().currentPageIndex);
  expect(idx).toBe(1); // landed on the new blank page
});

test('New Design opens the size dialog and creates a blank design', async ({ page }) => {
  await bootEditor(page);
  await page.locator('[data-action="new-design"]').click();
  await expect(page.locator('.dialog-title')).toHaveText('New Design');
  await page.locator('#cr-width').fill('800');
  await page.locator('#cr-height').fill('1200');
  await page.locator('#cr-confirm').click();
  const doc = await page.evaluate(() => (window as any).__folio.state.get().design.document);
  expect(doc.width).toBe(800);
  expect(doc.height).toBe(1200);
  const layers = await page.evaluate(() => (window as any).__folio.state.get().design.layers.length);
  expect(layers).toBe(1); // a blank design = one background rect
});

test('Resize dialog exposes aspect-ratio presets', async ({ page }) => {
  await bootEditor(page);
  await page.locator('#canvas-resize').click();
  const presetText = await page.locator('#cr-preset').innerText();
  expect(presetText).toContain('Portrait 4:5');
  expect(presetText).toContain('Wide 16:9');
});
