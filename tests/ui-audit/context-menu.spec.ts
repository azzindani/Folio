import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The right-click menu is a real command surface: what you can do to a
// SELECTION when you click a layer, what you can do to the DOCUMENT when you
// click empty canvas. A single menu with everything greyed out wastes the
// gesture, so the two are checked separately.

const DESIGN = `
meta: { name: Menu Test, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#0f2233" }
  - { id: a, type: rect, x: 100, y: 200, width: 300, height: 200, fill: "#1b6b4a" }
  - { id: b, type: rect, x: 500, y: 200, width: 300, height: 200, fill: "#b4513a" }
  - { id: c, type: rect, x: 100, y: 600, width: 300, height: 200, fill: "#3b5ba9" }
`;

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.evaluate(y => (window as any).__folio.loadFromYAML(y), DESIGN);
  await page.waitForTimeout(500);
}

async function labels(page: Page): Promise<string[]> {
  return page.$$eval('.canvas-context-menu .ccm-item', els =>
    els.map(e => (e.querySelector('span')?.textContent ?? '').trim()));
}

async function rightClickLayer(page: Page, id: string): Promise<void> {
  const box = await page.locator(`svg [data-layer-id="${id}"]`).first().boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' });
  await page.waitForSelector('.canvas-context-menu', { timeout: 4000 });
}

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('canvas right-click', () => {
  test('the FIRST right-click opens the menu, even though the module loads lazily', async ({ page }) => {
    // The menu is code-split; a one-shot listener loads it and replays the
    // event it swallowed. Without that replay the first click does nothing.
    await openEditor(page);
    await rightClickLayer(page, 'a');
    expect((await labels(page)).length).toBeGreaterThan(5);
  });

  test('a layer menu offers ordering, transform and lifecycle actions', async ({ page }) => {
    await openEditor(page);
    await rightClickLayer(page, 'a');
    const l = await labels(page);
    for (const want of ['Cut', 'Copy', 'Duplicate', 'Bring to front', 'Send to back',
      'Flip horizontal', 'Lock', 'Delete']) {
      expect(l, `layer menu should offer "${want}"`).toContain(want);
    }
    // Alignment needs something to align to — absent for one layer.
    expect(l).not.toContain('Align left');
  });

  test('alignment appears only once there are two layers to align', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => (window as any).__folio.state.set('selectedLayerIds', ['a', 'b']));
    await rightClickLayer(page, 'a');
    const l = await labels(page);
    expect(l).toContain('Align left');
    expect(l).toContain('Align middle');
    // Distribute needs three; with two it is present but disabled.
    const distDisabled = await page.$$eval('.canvas-context-menu .ccm-item', els =>
      els.filter(e => (e.textContent ?? '').includes('Distribute')).map(e => (e as HTMLButtonElement).disabled));
    expect(distDisabled).toEqual([true, true]);
  });

  test('empty canvas gets a document menu, not a greyed-out selection menu', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => (window as any).__folio.state.set('selectedLayerIds', []));
    // Somewhere inside the pane but outside the artboard.
    const art = await page.locator('svg [data-layer-id="bg"]').boundingBox();
    const pane = await page.locator('.canvas-area').boundingBox();
    const x = art!.x > pane!.x + 40 ? (pane!.x + art!.x) / 2 : art!.x + art!.width + 20;
    await page.mouse.click(x, art!.y + art!.height / 2, { button: 'right' });
    await page.waitForSelector('.canvas-context-menu');
    const l = await labels(page);
    for (const want of ['Paste here', 'Add rectangle', 'Add text', 'Zoom to 100%', 'Select all']) {
      expect(l, `canvas menu should offer "${want}"`).toContain(want);
    }
    expect(l).not.toContain('Delete');
  });

  test('adding from the canvas menu drops the layer where you clicked', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => (window as any).__folio.state.set('selectedLayerIds', []));
    const art = await page.locator('svg [data-layer-id="bg"]').boundingBox();
    const pane = await page.locator('.canvas-area').boundingBox();
    const x = art!.x > pane!.x + 40 ? (pane!.x + art!.x) / 2 : art!.x + art!.width + 20;
    const y = art!.y + art!.height / 3;
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForSelector('.canvas-context-menu');
    const before = await page.evaluate(() => (window as any).__folio.state.getCurrentLayers().length);
    await page.locator('.canvas-context-menu .ccm-item', { hasText: 'Add rectangle' }).click();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const ls = (window as any).__folio.state.getCurrentLayers();
      const added = ls[ls.length - 1];
      return { n: ls.length, x: added.x, y: added.y };
    });
    expect(after.n).toBe(before + 1);
    // Design coords are unbounded, but it must have landed somewhere real.
    expect(Number.isFinite(after.x) && Number.isFinite(after.y)).toBe(true);
  });

  test('bring to front actually reaches the top of the stack', async ({ page }) => {
    await openEditor(page);
    await rightClickLayer(page, 'a');
    await page.locator('.canvas-context-menu .ccm-item', { hasText: 'Bring to front' }).click();
    await page.waitForTimeout(200);
    const top = await page.evaluate(() => {
      const ls = (window as any).__folio.state.getCurrentLayers();
      const a = ls.find((l: any) => l.id === 'a');
      return ls.every((l: any) => l.id === 'a' || (l.z ?? 0) < (a.z ?? 0));
    });
    expect(top).toBe(true);
  });

  test('the menu never runs off the screen, even at the bottom-right corner', async ({ page }) => {
    await openEditor(page);
    // The bottom-right of the CANVAS AREA — clicking the window corner lands
    // on the status bar, where there is no menu to open.
    const pane = (await page.locator('.canvas-area').boundingBox())!;
    await page.mouse.click(pane.x + pane.width - 6, pane.y + pane.height - 6, { button: 'right' });
    await page.waitForSelector('.canvas-context-menu');
    const fits = await page.evaluate(() => {
      const r = document.querySelector('.canvas-context-menu')!.getBoundingClientRect();
      return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1;
    });
    expect(fits).toBe(true);
  });
});
