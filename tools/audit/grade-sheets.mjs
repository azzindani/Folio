// Build 6-up contact sheets (2 cols × 3 rows, large legible cells) from a list of
// {path,label} items for strict quality grading vs the examples/ bar.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ITEMS = JSON.parse(await fs.readFile('/tmp/harness-eval/grade-items.json', 'utf8'));
const OUT = '/tmp/harness-eval/sheets';
await fs.mkdir(OUT, { recursive: true });
const PER = 6, COLS = 2;

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1240, height: 1680 }, deviceScaleFactor: 1 })).newPage();

let sheet = 0;
for (let i = 0; i < ITEMS.length; i += PER) {
  const chunk = ITEMS.slice(i, i + PER);
  const cells = await Promise.all(chunk.map(async c => {
    const b64 = (await fs.readFile(c.path)).toString('base64');
    return `<div class="cell"><div class="img"><img src="data:image/png;base64,${b64}"></div><div class="lab">${c.label}</div></div>`;
  }));
  const html = `<!doctype html><meta charset=utf8><style>
    *{margin:0;box-sizing:border-box}body{background:#222;padding:12px;font:13px/1.3 monospace;color:#eee}
    .grid{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:12px}
    .cell{background:#1a1a1a;border:1px solid #555;border-radius:4px;overflow:hidden}
    .img{height:500px;display:flex;align-items:center;justify-content:center;background:#2b2b2b}
    .img img{max-width:100%;max-height:100%;object-fit:contain}
    .lab{padding:5px 8px;color:#9fe;border-top:1px solid #444}
  </style><div class="grid">${cells.join('')}</div>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  sheet++;
  const file = path.join(OUT, `sheet-${String(sheet).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[sheet ${sheet}] ${chunk.length} items -> ${file}`);
}
await browser.close();
console.log(`done: ${sheet} sheets`);
