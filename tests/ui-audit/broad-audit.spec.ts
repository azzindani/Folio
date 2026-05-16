/**
 * Broad UI audit. Drives many user flows through Playwright, screenshots
 * everything, and surfaces anything that looks broken or feels off.
 */
import { test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, 'broad');
fs.mkdirSync(OUT, { recursive: true });

interface Note { step: string; severity: 'error' | 'warn' | 'info'; msg: string }
const notes: Note[] = [];

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function waitForEditor(page: Page): Promise<void> {
  await page.waitForSelector('.toolbar', { timeout: 10_000 });
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => notes.push({ step: 'console-error', severity: 'error', msg: err.message }));
  page.on('console', msg => {
    if (msg.type() === 'error') notes.push({ step: 'console-error', severity: 'error', msg: msg.text() });
    if (msg.type() === 'warning') notes.push({ step: 'console-warn', severity: 'warn', msg: msg.text() });
  });
  page.on('requestfailed', req => notes.push({ step: 'net', severity: 'warn', msg: `${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}` }));
});

test.afterAll(() => {
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
});

test('1. Toolbox — every drawing tool clickable, switches activeTool', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '01-initial');

  const toolBtns = page.locator('.toolbox-panel .tool-btn, .tools-panel .tool-btn');
  const count = await toolBtns.count();
  notes.push({ step: '1.tool-count', severity: 'info', msg: `tool buttons: ${count}` });

  for (let i = 0; i < Math.min(count, 12); i++) {
    const btn = toolBtns.nth(i);
    const title = await btn.getAttribute('title') ?? await btn.getAttribute('data-tool') ?? `tool-${i}`;
    const safe = title.replace(/[^a-z0-9-]/gi, '-').slice(0, 20);
    try {
      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(120);
      await shot(page, `1-tool-${i}-${safe}`);
    } catch (e) {
      notes.push({ step: `1.tool-click-${safe}`, severity: 'error', msg: (e as Error).message });
    }
  }
});

test('2. Layer panel — click each layer, verify selection, props panel populates', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  const rows = page.locator('.layer-row, [data-layer-id]').filter({ has: page.locator('text=/./')});
  const n = await rows.count();
  notes.push({ step: '2.layer-rows', severity: 'info', msg: `${n} layer rows` });

  for (let i = 0; i < Math.min(n, 8); i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(100);
    const propsText = await page.locator('.properties-content, .properties-panel').textContent({ timeout: 800 }).catch(() => '');
    const hasProps = (propsText ?? '').length > 30;
    notes.push({ step: `2.layer-${i}-props`, severity: hasProps ? 'info' : 'warn', msg: `props text length ${propsText?.length ?? 0}` });
  }
  await shot(page, '2-last-selection');
});

test('3. Properties panel — edit text content, position, font_size', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  const textLayer = page.locator('.layer-row').filter({ hasText: /headline|title|text/i }).first();
  if (await textLayer.count() === 0) {
    notes.push({ step: '3.no-text-layer', severity: 'warn', msg: 'no text layer found' });
    return;
  }
  await textLayer.click();
  await page.waitForTimeout(200);
  await shot(page, '3a-text-selected');

  // Edit X coordinate
  const xIn = page.locator('input[data-prop="x"]').first();
  if (await xIn.count() > 0) {
    await xIn.fill('100');
    await xIn.press('Enter');
    await page.waitForTimeout(200);
    await shot(page, '3b-x-changed');
  } else {
    notes.push({ step: '3.no-x-input', severity: 'warn', msg: 'no x input found' });
  }

  // Edit font size
  const fs = page.locator('input[data-prop="style.font_size"]').first();
  if (await fs.count() > 0) {
    const before = await fs.inputValue();
    await fs.fill('72');
    await fs.press('Enter');
    await page.waitForTimeout(200);
    const after = await fs.inputValue();
    notes.push({ step: '3.font-size-edit', severity: after === '72' ? 'info' : 'error', msg: `${before} → ${after}` });
    await shot(page, '3c-font-changed');
  } else {
    notes.push({ step: '3.no-font-input', severity: 'warn', msg: 'no font_size input found' });
  }
});

test('4. Undo/redo round-trip', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '4a-initial');

  // Select first layer and try to move it via drag on selection box
  const firstLayer = page.locator('.layer-row').first();
  await firstLayer.click();
  await page.waitForTimeout(200);

  const selBox = page.locator('.selection-box').first();
  const box = await selBox.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await shot(page, '4b-after-move');
  }

  await page.locator('button[data-action="undo"]').click();
  await page.waitForTimeout(200);
  await shot(page, '4c-after-undo');

  await page.locator('button[data-action="redo"]').click();
  await page.waitForTimeout(200);
  await shot(page, '4d-after-redo');
});

test('5. Theme switcher', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '5a-default-theme');

  const select = page.locator('.toolbar-theme-select');
  for (const value of ['light-clean', 'ocean-blue', 'dark-tech']) {
    await select.selectOption(value).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, `5-theme-${value}`);
  }
});

test('6. Mode toggle — Visual / Payload', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '6a-visual');

  await page.locator('.mode-btn[data-mode="payload"]').click();
  await page.waitForTimeout(500);
  await shot(page, '6b-payload');

  await page.locator('.mode-btn[data-mode="visual"]').click();
  await page.waitForTimeout(300);
  await shot(page, '6c-back-to-visual');
});

test('7. Color picker — open and edit fill color', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  // Select a rect layer
  const rectRow = page.locator('.layer-row').filter({ hasText: /badge|card|bg|rect/i }).first();
  if (await rectRow.count() === 0) {
    notes.push({ step: '7.no-rect', severity: 'warn', msg: 'no rect layer' });
    return;
  }
  await rectRow.click();
  await page.waitForTimeout(200);

  const colorWell = page.locator('.color-well, [data-color-well], .prop-color-well').first();
  if (await colorWell.count() === 0) {
    notes.push({ step: '7.no-well', severity: 'warn', msg: 'no color well in props' });
    return;
  }
  await colorWell.click();
  await page.waitForTimeout(300);
  await shot(page, '7a-picker-open');

  const picker = page.locator('.color-picker-popover');
  const visible = await picker.isVisible().catch(() => false);
  notes.push({ step: '7.picker-visible', severity: visible ? 'info' : 'error', msg: `${visible}` });
});

test('8. Activity bar — switch each side panel', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  const lActBtns = page.locator('.activity-bar .activity-btn, .activity-bar button');
  const ln = await lActBtns.count();
  notes.push({ step: '8.left-activity-count', severity: 'info', msg: `${ln}` });
  for (let i = 0; i < Math.min(ln, 8); i++) {
    try {
      await lActBtns.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(200);
      await shot(page, `8-lact-${i}`);
    } catch (e) {
      notes.push({ step: `8.lact-${i}`, severity: 'warn', msg: (e as Error).message });
    }
  }

  const rActBtns = page.locator('.r-activity-bar .activity-btn, .r-activity-bar button');
  const rn = await rActBtns.count();
  notes.push({ step: '8.right-activity-count', severity: 'info', msg: `${rn}` });
  for (let i = 0; i < Math.min(rn, 8); i++) {
    try {
      await rActBtns.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(200);
      await shot(page, `8-ract-${i}`);
    } catch (e) {
      notes.push({ step: `8.ract-${i}`, severity: 'warn', msg: (e as Error).message });
    }
  }
});

test('9. Status bar — zoom in / out / fit', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  const zoomLabelBefore = await page.locator('.status-bar').textContent({ timeout: 800 }).catch(() => '');
  notes.push({ step: '9.zoom-label-before', severity: 'info', msg: (zoomLabelBefore ?? '').slice(0, 60) });

  for (const id of ['#zoom-in', '#zoom-in', '#zoom-out', '#zoom-fit']) {
    const btn = page.locator(id);
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(150);
    }
  }
  await shot(page, '9-after-zoom-ops');
});

test('10. Command palette (Ctrl+Shift+P)', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(200);
  await shot(page, '10-palette-opened');
  const palVisible = await page.locator('.command-palette').isVisible().catch(() => false);
  notes.push({ step: '10.palette-visible', severity: palVisible ? 'info' : 'warn', msg: `${palVisible}` });
});

test('11. Keyboard shortcuts — Delete, duplicate, select all', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await page.locator('.layer-row').first().click();
  await page.waitForTimeout(150);

  const layersBefore = await page.locator('.layer-row').count();

  // Ctrl+D duplicate
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  const layersAfterDup = await page.locator('.layer-row').count();
  notes.push({
    step: '11.dup',
    severity: layersAfterDup > layersBefore ? 'info' : 'warn',
    msg: `before=${layersBefore} after-dup=${layersAfterDup}`,
  });
  await shot(page, '11a-after-dup');

  // Delete
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  const layersAfterDel = await page.locator('.layer-row').count();
  notes.push({
    step: '11.del',
    severity: layersAfterDel < layersAfterDup ? 'info' : 'warn',
    msg: `before=${layersAfterDup} after-del=${layersAfterDel}`,
  });
  await shot(page, '11b-after-del');
});

test('12. Canvas pan via space+drag', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '12a-before-pan');

  const canvas = page.locator('.canvas-section, .canvas-area, .viewport-area').first();
  const box = await canvas.boundingBox();
  if (!box) {
    notes.push({ step: '12.no-canvas-box', severity: 'warn', msg: 'no canvas bounding box' });
    return;
  }

  await page.keyboard.down('Space');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(200);
  await shot(page, '12b-after-pan');
});
