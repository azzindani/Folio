// Open the live editor at an open_url and capture what the VIEWPORT actually renders:
//   - editor.svg   : the live <svg> the editor mounts (.canvas-svg-container svg)
//   - editor.png   : screenshot of that svg element at 2x
// Usage: node tools/hifi-export/capture-editor.mjs "<open_url>" <outDir/base>
import { chromium } from 'playwright';
import * as fs from 'fs';

const url = process.argv[2];
const out = process.argv[3] || '/tmp/editor';
if (!url) { console.error('need open_url'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// wait for the design svg to mount with children
await page.waitForSelector('.canvas-svg-container svg', { timeout: 30000 });
await page.waitForFunction(() => {
  const s = document.querySelector('.canvas-svg-container svg');
  return s && s.children.length > 3;
}, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);

const svg = await page.evaluate(() => {
  const s = document.querySelector('.canvas-svg-container svg');
  return s ? s.outerHTML : null;
});
fs.writeFileSync(out + '.svg', svg || '');
const el = await page.$('.canvas-svg-container svg');
await el.screenshot({ path: out + '.png' });
console.log('✓ wrote', out + '.svg', '+', out + '.png');
console.log('svg bytes:', (svg || '').length);
if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.slice(0, 10).join('\n'));
await browser.close();
