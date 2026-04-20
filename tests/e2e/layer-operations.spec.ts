import { test, expect } from '@playwright/test';

test.describe('Layer operations — duplicate / delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.locator('body').click({ position: { x: 300, y: 300 } });
  });

  test('Ctrl+D duplicates selected layer (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // Select first layer row in layer panel
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+d');
    expect(errors).toHaveLength(0);
  });

  test('Delete key removes selected layer (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await expect(row).toHaveClass(/selected/);
    await page.keyboard.press('Delete');
    expect(errors).toHaveLength(0);
  });

  test('Backspace key removes selected layer (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Backspace');
    expect(errors).toHaveLength(0);
  });

  test('Escape deselects all layers', async ({ page }) => {
    const row = page.locator('.layer-row').first();
    await row.click();
    await expect(row).toHaveClass(/selected/);
    await page.keyboard.press('Escape');
    const selected = page.locator('.layer-row.selected');
    await expect(selected).toHaveCount(0);
  });

  test('Ctrl+Z undoes last action (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('Control+z');
    expect(errors).toHaveLength(0);
  });

  test('Ctrl+Shift+Z redoes last action (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Layer operations — group / ungroup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.locator('body').click({ position: { x: 300, y: 300 } });
  });

  test('Ctrl+G with single layer is no-op (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+g');
    expect(errors).toHaveLength(0);
  });

  test('Ctrl+Shift+G with no group selected is no-op (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+Shift+g');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Layer operations — z-order', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.locator('body').click({ position: { x: 300, y: 300 } });
  });

  test('Ctrl+] brings layer forward (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+]');
    expect(errors).toHaveLength(0);
  });

  test('Ctrl+[ sends layer backward (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+[');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Layer operations — copy/paste', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.locator('body').click({ position: { x: 300, y: 300 } });
  });

  test('Ctrl+C does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const row = page.locator('.layer-row').first();
    await row.click();
    await page.keyboard.press('Control+c');
    expect(errors).toHaveLength(0);
  });

  test('Ctrl+V does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('Control+v');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Layer operations — alignment toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('align toolbar is visible', async ({ page }) => {
    await expect(page.locator('.align-toolbar')).toBeVisible();
  });

  test('align toolbar has alignment buttons', async ({ page }) => {
    const toolbar = page.locator('.align-toolbar');
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('clicking align-left button does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // Select at least one layer
    await page.locator('.layer-row').first().click();
    const btn = page.locator('[data-action="align-left"], button[title*="left" i]').first();
    if (await btn.count() > 0) await btn.click();
    expect(errors).toHaveLength(0);
  });
});

test.describe('Layer operations — zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    await page.locator('body').click({ position: { x: 300, y: 300 } });
  });

  test('Ctrl+1 sets zoom to 100%', async ({ page }) => {
    await page.keyboard.press('Control+1');
    await expect(page.locator('.toolbar-zoom')).toContainText('100');
  });

  test('Ctrl+0 fits canvas to screen (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('Control+0');
    expect(errors).toHaveLength(0);
  });
});
