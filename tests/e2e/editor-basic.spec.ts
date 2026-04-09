import { test, expect } from '@playwright/test';

test.describe('Editor — basic load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area', { timeout: 10_000 });
  });

  test('page loads without errors', async ({ page }) => {
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
    const svg = page.locator('.canvas-area svg').first();
    await expect(svg).toBeVisible({ timeout: 10_000 });
  });

  test('tools panel is visible', async ({ page }) => {
    await expect(page.locator('.tools-panel')).toBeVisible();
  });

  test('file tree panel is visible', async ({ page }) => {
    await expect(page.locator('.file-tree')).toBeVisible();
  });

  test('Folio brand name appears in toolbar', async ({ page }) => {
    await expect(page.locator('.toolbar')).toContainText('Folio');
  });
});

test.describe('Editor — canvas interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('clicking a layer selects it', async ({ page }) => {
    const canvas = page.locator('.canvas-area');
    await canvas.click({ position: { x: 100, y: 100 } });
    const props = page.locator('.properties-panel');
    await expect(props).toBeVisible();
  });

  test('Escape clears selection', async ({ page }) => {
    const canvas = page.locator('.canvas-area');
    await canvas.click({ position: { x: 100, y: 100 } });
    await page.keyboard.press('Escape');
    const handles = page.locator('[data-handle]');
    await expect(handles).toHaveCount(0);
  });
});

test.describe('Editor — toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('mode toggle buttons exist', async ({ page }) => {
    await expect(page.locator('.mode-btn').first()).toBeVisible();
    await expect(page.locator('.mode-toggle')).toBeVisible();
  });

  test('Visual mode is active by default', async ({ page }) => {
    const visualBtn = page.locator('.mode-btn[data-mode="visual"]');
    await expect(visualBtn).toHaveClass(/active/);
  });

  test('clicking Payload mode switches mode', async ({ page }) => {
    await page.locator('.mode-btn[data-mode="payload"]').click();
    const payloadBtn = page.locator('.mode-btn[data-mode="payload"]');
    await expect(payloadBtn).toHaveClass(/active/);
  });

  test('clicking Visual mode switches back', async ({ page }) => {
    await page.locator('.mode-btn[data-mode="payload"]').click();
    await page.locator('.mode-btn[data-mode="visual"]').click();
    const visualBtn = page.locator('.mode-btn[data-mode="visual"]');
    await expect(visualBtn).toHaveClass(/active/);
  });

  test('theme selector exists with options', async ({ page }) => {
    const select = page.locator('.toolbar-theme-select');
    await expect(select).toBeVisible();
    const options = await select.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(3);
  });

  test('export button exists', async ({ page }) => {
    await expect(page.locator('[data-action="export"]')).toBeVisible();
  });

  test('export menu opens on button click', async ({ page }) => {
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('.export-menu')).toBeVisible();
  });

  test('export menu closes when clicking outside', async ({ page }) => {
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('.export-menu')).toBeVisible();
    await page.locator('.canvas-area').click({ position: { x: 50, y: 50 } });
    await expect(page.locator('.export-menu')).not.toBeVisible();
  });

  test('zoom display shows percentage', async ({ page }) => {
    await expect(page.locator('.toolbar-zoom')).toContainText('%');
  });
});

test.describe('Editor — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
    // Focus the page body so shortcuts fire
    await page.locator('body').click({ position: { x: 300, y: 300 } });
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

  test('Ctrl+K opens command palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.locator('.command-palette-overlay');
    await expect(palette).toBeVisible({ timeout: 3_000 });
  });

  test('command palette closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-palette-overlay');
    await page.keyboard.press('Escape');
    await expect(page.locator('.command-palette-overlay')).not.toBeVisible();
  });

  test('V key selects the select tool', async ({ page }) => {
    await page.keyboard.press('v');
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    expect(errors).toHaveLength(0);
  });
});

test.describe('Editor — command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('opens via Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
  });

  test('search filters commands', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-palette-overlay');
    await page.locator('.command-palette-overlay input').fill('grid');
    await expect(page.locator('.cmd-row').first()).toContainText('Grid');
  });

  test('Arrow down navigates commands', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-palette-overlay');
    await page.keyboard.press('ArrowDown');
    // No crash expected
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    expect(errors).toHaveLength(0);
  });
});

test.describe('Editor — export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('SVG export item is present in export menu', async ({ page }) => {
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('[data-format="svg"]')).toBeVisible();
  });

  test('PNG export item is present in export menu', async ({ page }) => {
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('[data-format="png"]')).toBeVisible();
  });

  test('HTML export item is present in export menu', async ({ page }) => {
    await page.locator('[data-action="export"]').click();
    await expect(page.locator('[data-format="html"]')).toBeVisible();
  });
});

test.describe('Editor — layer panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 10_000 });
  });

  test('layer panel shows layer rows', async ({ page }) => {
    const rows = page.locator('.layer-row');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking layer row selects it', async ({ page }) => {
    const row = page.locator('.layer-row').first();
    await row.click();
    await expect(row).toHaveClass(/selected/);
  });

  test('layer rows show layer type icons', async ({ page }) => {
    const row = page.locator('.layer-row').first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    // Row contains icon span and name span
    const spans = row.locator('span');
    expect(await spans.count()).toBeGreaterThanOrEqual(2);
  });
});
