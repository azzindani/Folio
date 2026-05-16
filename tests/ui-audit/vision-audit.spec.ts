/**
 * Vision + control audit. Drives the running editor with Playwright and
 * screenshots each step so a human (or this assistant) can spot bugs.
 *
 * Run: npx playwright test --config=playwright.audit.config.ts vision-audit
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, 'vision');
fs.mkdirSync(OUT, { recursive: true });

interface Note { step: string; severity: 'error' | 'warn' | 'info'; msg: string }
const notes: Note[] = [];

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function waitForEditor(page: Page): Promise<void> {
  await page.waitForSelector('.toolbar-project-name', { timeout: 10_000 });
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => notes.push({ step: 'console', severity: 'error', msg: err.message }));
  page.on('console', msg => {
    if (msg.type() === 'error') notes.push({ step: 'console', severity: 'error', msg: msg.text() });
  });
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
});

test('A. Export button — click reveals menu, items work', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await shot(page, '01-initial');

  const exportBtn = page.locator('button[data-action="export"]');
  await expect(exportBtn).toBeVisible();
  const btnBox = await exportBtn.boundingBox();
  notes.push({ step: 'A.export-btn', severity: 'info', msg: `button @${JSON.stringify(btnBox)}` });

  await exportBtn.click();
  await page.waitForTimeout(150);
  await shot(page, '02-after-export-click');

  // Is the menu visible right after click?
  const menu = page.locator('.export-menu');
  const menuVisible = await menu.isVisible().catch(() => false);
  const menuDisplay = await menu.evaluate((el: HTMLElement) => el.style.display).catch(() => 'gone');
  const btnVisibleAfter = await exportBtn.isVisible().catch(() => false);

  notes.push({
    step: 'A.menu-state',
    severity: menuVisible ? 'info' : 'error',
    msg: `menu visible=${menuVisible} display="${menuDisplay}", button still visible=${btnVisibleAfter}`,
  });

  // Try clicking an item
  const svgItem = page.locator('.export-item[data-format="svg"]');
  const svgVisibleNow = await svgItem.isVisible().catch(() => false);
  notes.push({ step: 'A.svg-item-visible', severity: svgVisibleNow ? 'info' : 'error', msg: `${svgVisibleNow}` });

  if (svgVisibleNow) {
    await svgItem.click();
    await page.waitForTimeout(250);
    await shot(page, '03-after-svg-export');
  }

  // Re-open menu after action
  await exportBtn.click();
  await page.waitForTimeout(150);
  await shot(page, '04-reopen-menu');
});

test('B. Text resize via selection handles scales font_size', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  // Find a text layer in the layer panel and click it
  const textLayerEntry = page.locator('.layer-row, [data-layer-id]').filter({ hasText: /text|title|caption|hello/i }).first();
  const textCount = await textLayerEntry.count();
  if (textCount === 0) {
    // Fall back: click any text-type entry by data-type attribute
    const anyText = page.locator('[data-layer-type="text"], [data-layer-id]').first();
    await anyText.click().catch(() => {});
  } else {
    await textLayerEntry.click();
  }
  await page.waitForTimeout(250);
  await shot(page, '05-text-selected');

  // Look for the SE handle of the selection box
  const seHandle = page.locator('.selection-handle.handle-se, [data-handle="se"]');
  const handleVisible = await seHandle.first().isVisible().catch(() => false);
  notes.push({ step: 'B.se-handle-visible', severity: handleVisible ? 'info' : 'error', msg: `${handleVisible}` });

  if (!handleVisible) {
    await shot(page, '06-no-handle');
    return;
  }

  // Read font_size BEFORE drag from properties panel input (if present)
  const fontInputBefore = page.locator('input[data-prop="style.font_size"], input[data-prop="font_size"]').first();
  const fontBefore = await fontInputBefore.inputValue().catch(() => '');
  notes.push({ step: 'B.font-before', severity: 'info', msg: `font_size before = "${fontBefore}"` });

  // Drag the SE handle outward by 100px
  const box = await seHandle.first().boundingBox();
  if (!box) {
    notes.push({ step: 'B.no-bbox', severity: 'error', msg: 'SE handle has no bounding box' });
    return;
  }
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy + 60, { steps: 12 });
  await page.mouse.move(sx + 120, sy + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await shot(page, '07-after-resize-drag');

  const fontAfter = await fontInputBefore.inputValue().catch(() => '');
  notes.push({
    step: 'B.font-after',
    severity: fontAfter !== fontBefore && fontAfter !== '' ? 'info' : 'error',
    msg: `font_size after = "${fontAfter}" (before="${fontBefore}")`,
  });
});

test('C. General sweep — panels, viewports, console', async ({ page }) => {
  for (const vp of [
    { name: 'desktop', w: 1440, h: 900 },
    { name: 'laptop',  w: 1280, h: 800 },
    { name: 'tablet',  w: 900,  h: 1100 },
    { name: 'mobile',  w: 390,  h: 800 },
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/');
    await waitForEditor(page);
    await shot(page, `vp-${vp.name}`);

    // Look for any element overflowing the viewport horizontally
    const overflow = await page.evaluate(() => {
      const out: { tag: string; cls: string; w: number }[] = [];
      const docW = document.documentElement.clientWidth;
      document.querySelectorAll<HTMLElement>('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > docW + 1 && r.width > 0 && r.height > 0) {
          out.push({ tag: el.tagName, cls: el.className.toString().slice(0, 60), w: Math.round(r.right - docW) });
        }
      });
      return out.slice(0, 8);
    });
    if (overflow.length > 0) {
      notes.push({ step: `C.overflow-${vp.name}`, severity: 'warn', msg: JSON.stringify(overflow) });
    }
  }
});
