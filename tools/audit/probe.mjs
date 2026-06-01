import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const tpl = process.argv[2] ?? 'public/templates/builtin/99-receipt-thermal.template.yaml';
const yaml = readFileSync(path.join(ROOT, tpl),'utf8');

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const PORT = Number(process.env.FOLIO_AUDIT_PORT ?? 4273);
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__folio?.loadFromYAML);
await p.evaluate(s => window.__folio.loadFromYAML(s), yaml);
await p.waitForTimeout(300);
const info = await p.evaluate(() => {
  const texts = [...document.querySelectorAll('.canvas-svg-container svg text')];
  return texts.slice(0, 18).map(t => ({
    id: t.closest('g[data-layer-id]')?.getAttribute('data-layer-id'),
    x: t.getAttribute('x'),
    y: t.getAttribute('y'),
    anchor: t.getAttribute('text-anchor'),
    text: (t.textContent||'').slice(0, 40),
  }));
});
console.log(JSON.stringify(info, null, 2));
await b.close();
