#!/usr/bin/env node
// Render harness-suite designs to PNG against the LIVE editor (localhost:4173).
// Captures EVERY page of multi-page designs (carousels/sets).
//
//   FOLIO_AUDIT_TOKEN=<key> node tools/audit/render-harness.mjs \
//     --manifest /tmp/harness-eval/manifest.json --out /tmp/harness-eval/png --workers 3
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE  = process.env.FOLIO_AUDIT_BASE_URL ?? 'http://localhost:4173';
const TOKEN = process.env.FOLIO_AUDIT_TOKEN ?? '';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const MANIFEST = arg('--manifest', '/tmp/harness-eval/manifest.json');
const OUT      = arg('--out', '/tmp/harness-eval/png');
const WORKERS  = Math.max(1, Number(arg('--workers', '3')));

const HIDE = `.toolbar,.activity-bar,.left-panel,.properties-panel,.status-bar,.formula-bar,
  .tab-bar-container,.page-strip-section,.toolbar-zoom,.minimap-container{display:none!important}
  .canvas-section{padding:0!important}`;

async function settleAndShoot(page, outFile) {
  // Wait for async render + font swap (heavy display faces paint a frame late).
  await page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const seen = new Set(), reqs = [];
      document.querySelectorAll('.canvas-svg-container svg text').forEach(t => {
        const fam = t.getAttribute('font-family'), wt = t.getAttribute('font-weight') || '400',
          sz = t.getAttribute('font-size') || '16', k = `${sz}px ${wt} ${fam}`;
        if (fam && !seen.has(k)) { seen.add(k); reqs.push(document.fonts.load(`${wt} ${sz}px ${fam}`).catch(() => null)); }
      });
      await Promise.all(reqs); await document.fonts.ready;
    } catch { /* no font API */ }
    const dl = Date.now() + 800;
    while (Date.now() < dl) {
      if (document.querySelectorAll('.folio-richtext[data-render-type="markdown"] > span').length === 0) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 250));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const svg = page.locator('.canvas-svg-container svg').first();
  await svg.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  const size = await svg.evaluate(el => ({
    w: Number(el.getAttribute('width') ?? el.viewBox?.baseVal?.width ?? 0),
    h: Number(el.getAttribute('height') ?? el.viewBox?.baseVal?.height ?? 0),
  })).catch(() => ({ w: 0, h: 0 }));
  await page.evaluate(({ w, h }) => {
    const el = document.querySelector('.canvas-svg-container svg');
    if (!el) return;
    el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
    el.style.transform = 'none'; el.style.transformOrigin = '0 0';
  }, size);
  const checks = await page.evaluate(() => {
    const svg = document.querySelector('.canvas-svg-container svg');
    if (!svg) return { empty: true, layers: 0 };
    return { empty: svg.querySelectorAll('[data-layer-id]').length === 0, layers: svg.querySelectorAll('[data-layer-id]').length };
  });
  await page.waitForTimeout(200);
  await svg.screenshot({ path: outFile, omitBackground: false });
  return { ...size, ...checks };
}

async function renderOne(page, entry) {
  const yaml = await fs.readFile(entry.path, 'utf8');
  const load = await page.evaluate(async (src) => {
    const w = window;
    if (!w.__folio?.loadFromYAML) return { ok: false, err: 'no __folio' };
    try { w.__folio.loadFromYAML(src); } catch (e) { return { ok: false, err: String(e?.message ?? e) }; }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const d = w.__folio.state?.get?.().design;
    return { ok: true, pages: (d?.pages?.length ?? 0) };
  }, yaml);
  if (!load.ok) return { id: entry.id, status: 'load-error', error: load.err };
  const pageCount = Math.max(1, load.pages || 1);
  const shots = [];
  for (let p = 0; p < pageCount; p++) {
    if (pageCount > 1) {
      await page.evaluate(i => window.__folio.state.set('currentPageIndex', i), p);
      await page.waitForTimeout(120);
    }
    const file = pageCount > 1 ? `${entry.id}__p${String(p + 1).padStart(2, '0')}.png` : `${entry.id}.png`;
    const r = await settleAndShoot(page, path.join(OUT, file));
    shots.push({ file, ...r });
  }
  return { id: entry.id, suite: entry.suite, name: entry.name, status: 'ok', pageCount, shots };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  async function mkWorker() {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__folio?.loadFromYAML, { timeout: 30000 });
    await page.addStyleTag({ content: HIDE });
    return page;
  }
  const pages = await Promise.all(Array.from({ length: WORKERS }, mkWorker));
  console.log(`[render] ${WORKERS} workers ready @ ${BASE} — ${manifest.length} designs`);
  const results = new Array(manifest.length);
  let idx = 0, done = 0;
  async function loop(page, wid) {
    while (true) {
      const i = idx++; if (i >= manifest.length) break;
      let r; try { r = await renderOne(page, manifest[i]); }
      catch (e) { r = { id: manifest[i].id, status: 'exception', error: String(e?.message ?? e) }; }
      results[i] = r; done++;
      console.log(`[w${wid} ${done}/${manifest.length}] ${r.id} ${r.status} ${r.pageCount ? `pages=${r.pageCount}` : ''}${r.shots?.some(s => s.empty) ? ' EMPTY!' : ''}`);
    }
  }
  await Promise.all(pages.map((p, i) => loop(p, i + 1)));
  await fs.writeFile(path.join(OUT, 'render-results.json'), JSON.stringify(results, null, 2));
  const empties = results.filter(r => r.shots?.some(s => s.empty) || r.status !== 'ok');
  console.log(`\n[render] done. ${results.length} designs, ${results.reduce((n, r) => n + (r.shots?.length || 0), 0)} pages. ${empties.length} need attention.`);
  await browser.close();
}
await main();
