/**
 * WP-4.10 — pin constraints end-to-end against the live editor at :4173.
 * Verifies the pin-button UI writes constraints, and that resizing the document
 * repositions a pinned layer to keep its edge offset.
 */
import { test, expect } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const YAML = `
_protocol: design/v1
meta: { id: pin-test, name: Pin Test, type: poster }
document: { width: 1000, height: 600, unit: px }
layers:
  - { id: box, type: rect, z: 1, x: 800, y: 40, width: 100, height: 80, fill: "#3b82f6" }
`;

test.describe.configure({ mode: 'serial' });

test('pin button writes constraints and resize keeps the right-edge offset', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);
  const loaded = await loadYAMLIntoEditor(page, YAML);
  expect(loaded.ok, loaded.error).toBeTruthy();

  // Select the layer.
  await page.evaluate(() => {
    const f = (window as unknown as { __folio: { state: { set(k: string, v: unknown): void } } }).__folio;
    f.state.set('selectedLayerIds', ['box']);
  });

  // Click the "R" pin button in the properties panel.
  const rightPin = page.locator('.pin-btn[data-pin="right"]');
  await expect(rightPin).toBeVisible();
  await rightPin.click();

  // constraints.right is now set on the layer.
  const pinned = await page.evaluate(() => {
    const f = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; constraints?: Record<string, boolean> }> } } } } }).__folio;
    return f.state.get().design.layers.find(l => l.id === 'box')?.constraints?.right === true;
  });
  expect(pinned).toBeTruthy();

  // Resize the document 1000→1400 wide through the public app method + dialog.
  await page.evaluate(() => {
    (window as unknown as { __folio: { openResizeDialog(): void } }).__folio.openResizeDialog();
  });
  await page.fill('#cr-width', '1400');
  await page.click('#cr-confirm');

  // Right gap was 1000-800-100 = 100 → new x = 1400-100-100 = 1200.
  const nx = await page.evaluate(() => {
    const f = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; x: number; width: number }> } } } } }).__folio;
    const l = f.state.get().design.layers.find(l => l.id === 'box');
    return { x: l?.x, w: l?.width };
  });
  expect(nx.x).toBe(1200);
  expect(nx.w).toBe(100);
});
