// Ad-hoc mobile UI/UX screenshotter — captures the editor at phone/tablet
// widths in several states so we can eyeball what's cropped after the new
// toolbar/page features. Run from repo root: node tools/audit/mobile-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4399';
const OUT = '/tmp/claude-0/-root-Folio/df40673d-10f2-44ed-b3b7-148c1a14e97b/scratchpad/mobshots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone', w: 390, h: 844 },
  { name: 'android-sm', w: 360, h: 640 },
  { name: 'tablet', w: 768, h: 1024 },
];

const GROUPED = `
meta: { name: Mobile Test, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - id: g1
    type: group
    x: 0
    y: 0
    layers:
      - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#10243f" }
      - { id: h, type: text, x: 80, y: 120, width: 900, content: "Weekend Market", style: { font_size: 92, color: "#ffffff", font_weight: 800 } }
      - { id: s, type: text, x: 80, y: 300, width: 900, content: "Saturday 9am to 2pm", style: { font_size: 44, color: "#9fd3ff" } }
`;

async function shoot(page, vp, label) {
  await page.screenshot({ path: `${OUT}/${vp.name}-${label}.png` });
}

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: vp.w < 768 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window.__folio?.state?.get().design)).catch(() => {});
  await page.waitForTimeout(600);
  await shoot(page, vp, '1-initial');

  // Toolbar close-up (top strip)
  const tb = page.locator('.toolbar').first();
  if (await tb.count()) await tb.screenshot({ path: `${OUT}/${vp.name}-2-toolbar.png` }).catch(() => {});

  // Load a grouped poster, then add a page so the page strip shows
  await page.evaluate((y) => window.__folio.loadFromYAML(y), GROUPED).catch(() => {});
  await page.waitForTimeout(400);
  await shoot(page, vp, '3-loaded');

  await page.locator('[data-action="add-page"]').click().catch(() => {});
  await page.waitForTimeout(400);
  await shoot(page, vp, '4-pagestrip');

  // New-design dialog
  await page.locator('[data-action="new-design"]').click().catch(() => {});
  await page.waitForTimeout(400);
  await shoot(page, vp, '5-newdialog');
  await page.keyboard.press('Escape').catch(() => {});

  await ctx.close();
}
await browser.close();
console.log('shots written to', OUT);
