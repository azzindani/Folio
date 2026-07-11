/**
 * WP-4.8 — import an SVG (with group/element transforms) as editable layers.
 * Drives the real "Import SVG as Layers" command + file chooser so element CTMs
 * resolve in a real browser; asserts transforms are baked into absolute coords.
 */
import { test, expect } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const BASE = `
_protocol: design/v1
meta: { id: svg-imp, name: SVG Import, type: poster }
document: { width: 400, height: 400, unit: px }
layers:
  - { id: bg, type: rect, z: 0, x: 0, y: 0, width: 400, height: 400, fill: "#ffffff" }
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g transform="translate(50,30)"><rect x="0" y="0" width="40" height="40" fill="#3b82f6"/></g>
  <path d="M0 0L20 0L20 20Z" fill="#111111" transform="translate(100,100)"/>
</svg>`;

test('SVG imports with transforms baked into absolute coordinates', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);
  expect((await loadYAMLIntoEditor(page, BASE)).ok).toBeTruthy();

  // Run the command via the palette (Ctrl+K → filter → Enter), catch the chooser.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.keyboard.press('Control+k');
      await page.locator('.command-palette-overlay input').fill('Import SVG');
      await page.keyboard.press('Enter');
    })(),
  ]);
  await chooser.setFiles({ name: 'test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => {
    const layers = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; type: string; x?: number; y?: number; d?: string }> } } } } })
      .__folio.state.get().design.layers;
    const rect = layers.find(l => l.type === 'rect' && l.id !== 'bg');
    const path = layers.find(l => l.type === 'path');
    return { count: layers.length, rect, pathD: path?.d };
  });

  // group translate(50,30) baked onto the rect
  expect(state.rect?.x).toBe(50);
  expect(state.rect?.y).toBe(30);
  // element translate(100,100) baked into the path d
  expect(state.pathD).toContain('M100 100');
  expect(state.pathD).toContain('120 100');
});
