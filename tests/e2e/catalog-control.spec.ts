import { test, expect } from '@playwright/test';

test.describe('Catalog control — toolbar button + dialog interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.toolbar', { timeout: 10_000 });
  });

  test('Catalog button is visible in toolbar-center, next to mode toggle', async ({ page }) => {
    const btn = page.locator('.toolbar-center [data-action="catalog"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Catalog/);
  });

  test('Catalog button has accessible label', async ({ page }) => {
    const btn = page.locator('[data-action="catalog"]');
    await expect(btn).toHaveAttribute('aria-label', 'Open Folio Catalog');
  });

  test('clicking the Catalog button opens the catalog dialog', async ({ page }) => {
    await page.locator('[data-action="catalog"]').click();
    await expect(page.locator('.dialog-overlay.catalog-overlay')).toBeVisible();
  });

  test('catalog dialog renders preview rail and pick chip area', async ({ page }) => {
    await page.locator('[data-action="catalog"]').click();
    await expect(page.locator('[data-rail="preview"]')).toBeVisible();
    await expect(page.locator('[data-rail="pick"]')).toBeAttached();
  });

  test('catalog dialog renders at least one template card', async ({ page }) => {
    await page.locator('[data-action="catalog"]').click();
    // Cards are populated after the index resolves (one-time HTTP roundtrip
    // for the metadata JSON). Wait for any card to attach; use 'attached'
    // because content-visibility:auto may keep off-screen cards
    // technically-not-visible from Playwright's strict POV.
    await page.locator('.tmpl-card').first().waitFor({ state: 'attached', timeout: 10_000 });
    expect(await page.locator('.tmpl-card').count()).toBeGreaterThan(0);
  });

  test('clicking a template card updates the live-preview pick chips', async ({ page }) => {
    await page.locator('[data-action="catalog"]').click();
    const firstCard = page.locator('.tmpl-card').first();
    await firstCard.waitFor({ state: 'attached', timeout: 10_000 });
    // scrollIntoViewIfNeeded forces the virtualized card to render and
    // become genuinely visible before we click it.
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();
    // After picking, the pick rail surfaces a "<template> × <theme>" pair
    await expect(page.locator('[data-rail="pick"] .rail-chip').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Escape closes the catalog dialog', async ({ page }) => {
    await page.locator('[data-action="catalog"]').click();
    await expect(page.locator('.dialog-overlay.catalog-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog-overlay.catalog-overlay')).toHaveCount(0);
  });

  test('Catalog button is no longer present in the file-tree panel', async ({ page }) => {
    // The button was moved out. The file-tree should still render Open/Save,
    // but not "Catalog".
    const fileTreeCatalog = page.locator('.file-tree-content button', { hasText: /^Catalog$/ });
    expect(await fileTreeCatalog.count()).toBe(0);
  });
});
