// Build labeled contact sheets from a shots dir so a whole catalog can be
// visually triaged in a few images. Tiles PNGs into a grid HTML, screenshots
// each page with Playwright. Usage: node tools/audit/contact-sheet.mjs <shotsDir> [perSheet]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SHOTS = process.argv[2] || 'tools/audit/shots/all';
const PER = Number(process.argv[3] || 42);
const COLS = 7;
const CELL = 226; // px thumb box

const files = (await fs.readdir(SHOTS)).filter(f => f.endsWith('.png') && !f.startsWith('_sheet')).sort(
  (a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || a.localeCompare(b),
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: COLS * CELL + 24, height: 1400 } });

let sheet = 0;
for (let i = 0; i < files.length; i += PER) {
  const chunk = files.slice(i, i + PER);
  const cells = chunk.map(f => {
    const label = f.replace('.png', '');
    return `<div class="c"><img src="./${f}"/><div class="l">${label}</div></div>`;
  }).join('');
  const html = `<!doctype html><meta charset=utf8><style>
    body{margin:0;background:#222;font:11px/1.2 system-ui;display:flex;flex-wrap:wrap;gap:4px;padding:8px}
    .c{width:${CELL}px;height:${CELL + 22}px;background:#2c2c2c;border-radius:4px;overflow:hidden;display:flex;flex-direction:column}
    .c img{width:${CELL}px;height:${CELL}px;object-fit:contain;background:#fff}
    .l{color:#ddd;padding:3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style>${cells}`;
  // Write the HTML INTO the shots dir and navigate to it so relative ./img
  // paths resolve (file:// in setContent is blocked from loading file images).
  const htmlPath = path.join(SHOTS, `_sheet${String(sheet).padStart(2, '0')}.html`);
  await fs.writeFile(htmlPath, html);
  await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const out = path.join(SHOTS, `_sheet${String(sheet).padStart(2, '0')}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await fs.unlink(htmlPath).catch(() => {});
  console.log(`sheet ${sheet}: ${chunk.length} tiles → ${out}`);
  sheet++;
}
await browser.close();
console.log(`done: ${sheet} sheets, ${files.length} tiles`);
