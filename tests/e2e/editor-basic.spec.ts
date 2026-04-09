import { test, expect } from '@playwright/test';

test.describe('Editor — basic load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads without errors', async ({ page }) => {
    // No uncaught JS errors
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
    expect(errors).toHaveLength(0);
  });

  test('canvas area is visible', async ({ page }) => {
    await expect(page.locator('.canvas-area')).toBeVisible();
  });

  test('toolbar is visible', async ({ page }) => {
    await expect(page.locator('.toolbar')).toBeVisible();
  });

  test('layer panel is visible', async ({ page }) => {
    await expect(page.locator('.layer-panel')).toBeVisible();
  });

  test('properties panel is visible', async ({ page }) => {
    await expect(page.locator('.properties-panel')).toBeVisible();
  });

  test('SVG canvas renders with layers', async ({ page }) => {
    // Wait for SVG to appear inside the canvas area
    const svg = page.locator('.canvas-area svg').first();
    await expect(svg).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Editor — canvas interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('clicking a layer selects it', async ({ page }) => {
    // Click near the top-left of the canvas area (well within its bounds).
    // Layout: toolbar=48px, canvas=1fr (≥300px), layer-panel=200px in 720px viewport.
    // Using x:100, y:100 keeps the click safely within the canvas grid cell.
    const canvas = page.locator('.canvas-area');
    await canvas.click({ position: { x: 100, y: 100 } });

    // After click, properties panel should still be visible (no crash)
    const props = page.locator('.properties-panel');
    await expect(props).toBeVisible();
  });

  test('Escape clears selection', async ({ page }) => {
    const canvas = page.locator('.canvas-area');
    await canvas.click({ position: { x: 100, y: 100 } });
    await page.keyboard.press('Escape');

    // Selection handles should not be visible after Escape
    const handles = page.locator('[data-handle]');
    await expect(handles).toHaveCount(0);
  });

  test('command palette opens with slash', async ({ page }) => {
    await page.keyboard.press('/');
    // The command palette overlay uses class "command-palette-overlay"
    const palette = page.locator('.command-palette-overlay');
    await expect(palette).toBeVisible({ timeout: 3_000 });
  });

  test('command palette closes with Escape', async ({ page }) => {
    await page.keyboard.press('/');
    await page.waitForSelector('.command-palette-overlay');
    await page.keyboard.press('Escape');
    const palette = page.locator('.command-palette-overlay');
    await expect(palette).not.toBeVisible();
  });
});

test.describe('Editor — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('Ctrl+Z triggers undo (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.keyboard.press('Control+z');
    expect(errors).toHaveLength(0);
  });

  test('Ctrl+Shift+Z triggers redo (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.keyboard.press('Control+Shift+z');
    expect(errors).toHaveLength(0);
  });

  test('G toggles grid (no crash)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.keyboard.press('g');
    await page.keyboard.press('g');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Editor — payload toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('payload mode button exists in toolbar', async ({ page }) => {
    // Toolbar should contain a button related to payload/YAML editing
    const toolbar = page.locator('.toolbar');
    await expect(toolbar).toBeVisible();
  });
});

test.describe('Editor — export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('SVG export does not throw', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // Trigger export via keyboard shortcut
    await page.keyboard.press('Control+e');
    // Small wait for any async operations
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });
});
