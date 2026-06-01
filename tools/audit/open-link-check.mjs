// Open the MCP editor link in a real headless browser and confirm the
// design loads + renders. Usage: node open-link-check.mjs "<url>"
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2];
if (!url) { console.error('need url'); process.exit(2); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
const reqs = [];
page.on('response', r => { const u = r.url(); if (u.includes('__project_files') || u.includes('editor/events')) reqs.push(`${r.status()} ${u.split('?')[0].split('casava.space')[1] ?? u}`); });

const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
console.log('nav status:', resp?.status());

// Wait for the editor to load the design into the canvas SVG.
let found = false;
for (let i = 0; i < 40; i++) {
  const txt = await page.evaluate(() => {
    const svg = document.querySelector('.canvas-svg-container svg') || document.querySelector('svg');
    return svg ? svg.textContent : null;
  });
  if (txt && txt.includes('FOLIO ENGINE')) { found = true; break; }
  await page.waitForTimeout(250);
}

// Paint-settle for fonts (per project-snapshot-font-race), then capture.
await page.waitForTimeout(400);
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

const info = await page.evaluate(() => {
  const svg = document.querySelector('.canvas-svg-container svg') || document.querySelector('svg');
  const texts = svg ? Array.from(svg.querySelectorAll('text')).map(t => t.textContent.trim()).filter(Boolean) : [];
  const rects = svg ? svg.querySelectorAll('rect').length : 0;
  const bb = svg ? svg.getBoundingClientRect() : null;
  return { hasSvg: !!svg, vb: svg?.getAttribute('viewBox'), w: bb?.width, h: bb?.height, texts, rects, title: document.title };
});

fs.mkdirSync('/root/Folio/tools/audit/vision', { recursive: true });
await page.screenshot({ path: '/root/Folio/tools/audit/vision/editor-open-full.png', fullPage: false });
const canvas = await page.$('.canvas-svg-container svg') || await page.$('svg');
if (canvas) await canvas.screenshot({ path: '/root/Folio/tools/audit/vision/editor-open-canvas.png' });

console.log('headline rendered (FOLIO ENGINE present):', found);
console.log('design info:', JSON.stringify(info, null, 2));
console.log('relevant network:', JSON.stringify(reqs, null, 2));
const warns = logs.filter(l => /error|warn|fail|unauthor|cannot/i.test(l));
console.log('console warns/errors:', warns.length ? JSON.stringify(warns, null, 2) : 'none');

await browser.close();
process.exit(found ? 0 : 1);
