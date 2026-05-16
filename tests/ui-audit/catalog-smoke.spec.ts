/**
 * Catalog smoke: open the Catalog, tab through Templates / Themes /
 * Reports / Featured, pick one combo, verify the editor swaps to the
 * chosen design.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, 'catalog');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

test('Folio Catalog — browse + pick + open', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.toolbar', { timeout: 10_000 });
  await page.waitForTimeout(300);

  // Open file panel to reveal the Catalog button (folder icon, left rail).
  await page.locator('.activity-bar button, .activity-bar .activity-btn').nth(1).click().catch(() => {});
  await page.waitForTimeout(200);

  // Open the catalog
  await page.locator('button').filter({ hasText: /^Catalog$/ }).first().click();
  await page.waitForSelector('.catalog', { timeout: 5000 });
  await page.waitForTimeout(300);
  await shot(page, '01-templates-tab');

  // Verify all 4 tabs are present
  const tabs = page.locator('.catalog-tab');
  await expect(tabs).toHaveCount(4);

  // Search bar narrows the template list
  const initialCards = await page.locator('.tmpl-card[data-template]').count();
  expect(initialCards).toBeGreaterThan(0);
  await page.locator('input[data-input="search"]').fill('stats');
  await page.waitForTimeout(150);
  const filteredCards = await page.locator('.tmpl-card[data-template]').count();
  expect(filteredCards, 'search should narrow the grid').toBeLessThan(initialCards);
  expect(filteredCards).toBeGreaterThan(0);
  await shot(page, '01b-search-stats');

  // Tag chip click filters too — clear search first
  await page.locator('input[data-input="search"]').fill('');
  await page.waitForTimeout(100);
  const firstChip = page.locator('.tag-chip').first();
  if (await firstChip.count() > 0) {
    await firstChip.click();
    await page.waitForTimeout(100);
    const taggedCount = await page.locator('.tmpl-card[data-template]').count();
    expect(taggedCount).toBeGreaterThan(0);
    await shot(page, '01c-tag-filter');
    // Clear filter so subsequent steps see the full set
    await page.locator('.tag-chip.clear').click().catch(() => {});
  }

  // Switch to Themes
  await page.locator('.catalog-tab[data-tab="themes"]').click();
  await page.waitForTimeout(200);
  await shot(page, '02-themes-tab');
  const themeCards = page.locator('[data-theme-id]');
  expect(await themeCards.count(), 'should show ≥7 themes').toBeGreaterThanOrEqual(7);

  // Switch to Reports
  await page.locator('.catalog-tab[data-tab="reports"]').click();
  await page.waitForTimeout(200);
  await shot(page, '03-reports-tab');
  const reportCards = page.locator('[data-template]');
  expect(await reportCards.count(), 'should show ≥2 report templates').toBeGreaterThanOrEqual(2);

  // Switch to Featured
  await page.locator('.catalog-tab[data-tab="featured"]').click();
  await page.waitForTimeout(200);
  await shot(page, '04-featured-tab');
  const comboCards = page.locator('[data-combo-id]');
  expect(await comboCards.count(), 'should show ≥5 combos').toBeGreaterThanOrEqual(5);

  // Pick a combo
  await comboCards.first().click();
  await page.waitForTimeout(400);
  await shot(page, '05-combo-picked');

  // Right rail must show a non-empty preview svg
  const previewSvg = page.locator('.rail-preview svg');
  await expect(previewSvg).toBeVisible({ timeout: 3000 });

  // Open in editor
  await page.locator('button[data-action="open"]').click();
  await page.waitForTimeout(500);
  await shot(page, '06-after-open');

  // Editor should have replaced the design
  const title = await page.locator('.toolbar-project-name').textContent({ timeout: 3000 });
  expect(title ?? '').toContain('Untitled');
});
