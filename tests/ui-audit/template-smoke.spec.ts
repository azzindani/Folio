/**
 * Smoke test: open the template picker, verify cards render, pick one,
 * confirm the editor swaps to the picked template's design.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, 'template');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

test('Template picker — opens, shows cards, loads a template', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.toolbar', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot(page, '01-initial');

  // Open file panel (left activity bar) to reveal the New button.
  // The file panel is the folder icon — second activity-bar button.
  const folderBtn = page.locator('.activity-bar button, .activity-bar .activity-btn').nth(1);
  await folderBtn.click().catch(() => {});
  await page.waitForTimeout(200);
  await shot(page, '02-file-panel-open');

  // Click the New button
  const newBtn = page.locator('button').filter({ hasText: /^New$/ }).first();
  await expect(newBtn).toBeVisible({ timeout: 5000 });
  await newBtn.click();
  await page.waitForTimeout(300);
  await shot(page, '03-picker-open');

  // Verify cards rendered
  const cards = page.locator('.tmpl-card');
  const cardCount = await cards.count();
  expect(cardCount, 'should render at least 6 starter templates').toBeGreaterThanOrEqual(6);

  // Pick the Quote Card (alphabetically findable by name)
  const quoteCard = cards.filter({ hasText: /Quote Card/i }).first();
  await expect(quoteCard).toBeVisible();
  await quoteCard.click();
  await page.waitForTimeout(500);
  await shot(page, '04-after-pick');

  // Verify the toolbar title now reflects the new untitled design
  const title = await page.locator('.toolbar-project-name').textContent({ timeout: 3000 });
  expect(title ?? '').toContain('Quote Card');
});
