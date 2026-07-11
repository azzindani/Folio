/**
 * WP-4.7 — path booleans. Two overlapping rects, select both, Union → one path
 * layer holding the union outline (the same `d` that renders in resvg).
 */
import { test, expect } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const YAML = `
_protocol: design/v1
meta: { id: bool-test, name: Bool Test, type: poster }
document: { width: 400, height: 400, unit: px }
layers:
  - { id: a, type: rect, z: 1, x: 20, y: 20, width: 120, height: 120, fill: "#3b82f6" }
  - { id: b, type: rect, z: 2, x: 90, y: 90, width: 120, height: 120, fill: "#ef4444" }
`;

test('Union merges two rects into one path layer', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);
  const loaded = await loadYAMLIntoEditor(page, YAML);
  expect(loaded.ok, loaded.error).toBeTruthy();

  await page.evaluate(() => {
    (window as unknown as { __folio: { state: { set(k: string, v: unknown): void } } }).__folio.state.set('selectedLayerIds', ['a', 'b']);
  });

  await page.click('.bool-op-btn[data-op="union"]');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const layers = (window as unknown as { __folio: { state: { get(): { design: { layers: Array<{ id: string; type: string; d?: string }> } } } } })
      .__folio.state.get().design.layers;
    const paths = layers.filter(l => l.type === 'path');
    return { count: layers.length, pathCount: paths.length, d: paths[0]?.d, ids: layers.map(l => l.id) };
  });
  // source rects gone, one path added
  expect(result.pathCount).toBe(1);
  expect(result.ids).not.toContain('a');
  expect(result.ids).not.toContain('b');
  expect(result.d?.startsWith('M')).toBe(true);
  expect(result.d?.endsWith('Z')).toBe(true);
});
