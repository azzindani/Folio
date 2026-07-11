/**
 * WP-4.9 — on-canvas gradient handles + pattern/image fill panel controls.
 */
import { test, expect } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const YAML = `
_protocol: design/v1
meta: { id: fill-test, name: Fill Test, type: poster }
document: { width: 800, height: 600, unit: px }
layers:
  - { id: g, type: rect, z: 1, x: 100, y: 100, width: 300, height: 200,
      fill: { type: linear, angle: 90, stops: [ { color: "#6c5ce7", position: 0 }, { color: "#a29bfe", position: 100 } ] } }
`;

test.describe.configure({ mode: 'serial' });

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await waitForFolioReady(page);
  const loaded = await loadYAMLIntoEditor(page, YAML);
  expect(loaded.ok, loaded.error).toBeTruthy();
  await page.evaluate(() => {
    (window as unknown as { __folio: { state: { set(k: string, v: unknown): void } } }).__folio.state.set('selectedLayerIds', ['g']);
  });
}

test('a linear-fill layer shows two gradient axis handles on the canvas', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.grad-handle')).toHaveCount(2);
  await expect(page.locator('.grad-handle-p1')).toBeVisible();
  await expect(page.locator('.grad-handle-p2')).toBeVisible();
});

test('Pattern tab writes the MCP-shaped pattern fill spec', async ({ page }) => {
  await boot(page);
  await page.click('.fill-type-btn[data-fill-type="pattern"]');
  await page.selectOption('select[data-prop="fill.pattern"]', 'halftone');
  const fill = await page.evaluate(() => {
    const l = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; fill?: Record<string, unknown> }> } } } } })
      .__folio.state.get().design.layers.find(l => l.id === 'g');
    return l?.fill;
  });
  expect(fill?.type).toBe('pattern');
  expect(fill?.pattern).toBe('halftone');
  expect(typeof fill?.fg).toBe('string');
});

test('Image tab writes {type:image, src, mode}', async ({ page }) => {
  await boot(page);
  await page.click('.fill-type-btn[data-fill-type="image"]');
  await page.fill('input[data-prop="fill.src"]', 'assets/images/photo.jpg');
  const fill = await page.evaluate(() => {
    const l = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; fill?: Record<string, unknown> }> } } } } })
      .__folio.state.get().design.layers.find(l => l.id === 'g');
    return l?.fill;
  });
  expect(fill?.type).toBe('image');
  expect(fill?.src).toBe('assets/images/photo.jpg');
  expect(fill?.mode).toBe('cover');
});
