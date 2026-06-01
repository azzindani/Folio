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
  const result = {};
  result.themeName = (window).__folio?.state?.get?.()?.theme?.name ?? 'unknown';
  result.themeBg = (window).__folio?.state?.get?.()?.theme?.colors?.background ?? '?';
  result.themeText = (window).__folio?.state?.get?.()?.theme?.colors?.text ?? '?';
  const quote = document.querySelector('[data-layer-id="quote"] text');
  result.quoteFill = quote?.getAttribute('fill') ?? null;
  result.quoteComputed = quote ? getComputedStyle(quote).fill : null;
  result.quoteBBox = quote?.getBBox?.();
  const bg = document.querySelector('[data-layer-id="bg"] rect');
  result.bgFill = bg?.getAttribute('fill') ?? null;
  return result;
});
console.log(JSON.stringify(info, null, 2));
await b.close();
