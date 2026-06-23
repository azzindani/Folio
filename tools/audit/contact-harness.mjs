#!/usr/bin/env node
// Build contact sheets (labelled grids) from rendered harness PNGs for vision triage.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PNG = '/tmp/harness-eval/png';
const OUT = '/tmp/harness-eval/sheets';
const PER = 9;          // 3×3 per sheet — big cells, legible
const COLS = 3;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  let files = (await fs.readdir(PNG)).filter(f => f.endsWith('.png')).sort();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1650, height: 1650 }, deviceScaleFactor: 1 })).newPage();
  let sheet = 0;
  for (let i = 0; i < files.length; i += PER) {
    const chunk = files.slice(i, i + PER);
    const cells = await Promise.all(chunk.map(async f => {
      const b64 = (await fs.readFile(path.join(PNG, f))).toString('base64');
      const label = f.replace('.png', '');
      return `<div class="cell"><div class="img"><img src="data:image/png;base64,${b64}"></div><div class="lab">${label}</div></div>`;
    }));
    const html = `<!doctype html><html><head><meta charset=utf8><style>
      *{margin:0;box-sizing:border-box}body{background:#2b2b2b;font:13px/1.3 monospace;color:#eee;padding:10px}
      .grid{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:10px}
      .cell{background:#1a1a1a;border:1px solid #444;border-radius:4px;overflow:hidden}
      .img{height:480px;display:flex;align-items:center;justify-content:center;background:#0d0d0d}
      .img img{max-width:100%;max-height:100%;object-fit:contain}
      .lab{padding:6px 8px;background:#111;color:#9cf;font-size:12px;word-break:break-all;border-top:1px solid #333}
    </style></head><body><div class="grid">${cells.join('')}</div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Array.from(document.images).map(im => im.complete ? 1 : im.decode().catch(() => 1))));
    await page.waitForTimeout(200);
    const file = path.join(OUT, `sheet-${String(++sheet).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`sheet ${sheet}: ${chunk.length} designs → ${path.basename(file)}`);
  }
  await browser.close();
  console.log(`\n${sheet} sheets, ${files.length} designs total`);
}
await main();
