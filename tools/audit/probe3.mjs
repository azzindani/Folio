import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const tpl = process.argv[2];
const yaml = readFileSync(path.join(ROOT, tpl),'utf8');
const PORT = Number(process.env.FOLIO_AUDIT_PORT ?? 5073);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__folio?.loadFromYAML);
await p.evaluate(s => window.__folio.loadFromYAML(s), yaml);
await p.waitForTimeout(500);
const info = await p.evaluate(() => {
  const quote = document.querySelector('.canvas-svg-container [data-layer-id="quote"]');
  const text = quote?.querySelector('text');
  const tspans = quote?.querySelectorAll('tspan');
  const result = {
    quoteHTML: quote?.outerHTML?.slice(0, 600),
    textAttrs: text ? Object.fromEntries([...text.attributes].map(a => [a.name, a.value])) : null,
    tspanCount: tspans?.length ?? 0,
    bbox: text?.getBBox?.(),
    parentTransform: quote?.getAttribute('transform'),
  };
  return result;
});
console.log(JSON.stringify(info, null, 2));
await b.close();
