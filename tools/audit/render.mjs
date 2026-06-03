#!/usr/bin/env node
// Render a list of templates to PNG using the running editor + Playwright.
//
// Usage:
//   node tools/audit/render.mjs --list tools/audit/pilot.json [--out tools/audit/shots/pilot]
//   node tools/audit/render.mjs --all   --out tools/audit/shots/all
//
// Expects a Vite preview server reachable at http://localhost:4173.
// The script will start `npm run preview` automatically if nothing is
// listening on that port.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const TPL_DIR   = path.join(ROOT, 'public', 'templates', 'builtin');
// Use a non-standard port — :4173 may be held by a Docker container in
// this dev environment, which would serve a stale build.
const PORT      = Number(process.env.FOLIO_AUDIT_PORT ?? 4273);
// FOLIO_AUDIT_BASE_URL lets us render against an already-running editor (e.g.
// the live deployment) instead of a local vite preview — current engine, no
// local build needed. FOLIO_AUDIT_TOKEN is appended as ?token= on first nav
// (the editor 302s it into a session cookie). When BASE_URL is unset we fall
// back to spawning a local preview on :PORT.
const EXTERNAL_BASE = process.env.FOLIO_AUDIT_BASE_URL ?? null;
const AUDIT_TOKEN   = process.env.FOLIO_AUDIT_TOKEN ?? null;
const BASE_URL  = EXTERNAL_BASE ?? `http://localhost:${PORT}`;

// Each render is timeboxed; some templates pull heavy renderers
// (mermaid, vega-lite) on first use, so the first few may be slow.
const RENDER_TIMEOUT_MS = 15_000;

// ── CLI parsing ──────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = { list: null, all: false, outDir: null, limit: Infinity, workers: 1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--list')    out.list    = a[++i];
    else if (a[i] === '--all')     out.all     = true;
    else if (a[i] === '--out')     out.outDir  = a[++i];
    else if (a[i] === '--limit')   out.limit   = Number(a[++i]);
    else if (a[i] === '--workers') out.workers = Math.max(1, Number(a[++i]));
  }
  if (!out.list && !out.all) throw new Error('pass --list <json> or --all');
  if (!out.outDir) out.outDir = path.join(__dirname, 'shots', out.all ? 'all' : 'pilot');
  return out;
}

// ── Server bootstrap ────────────────────────────────────────────────
async function isLocalPortOpen(port) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ac.signal });
    clearTimeout(t);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isLocalPortOpen(PORT)) return null;
  console.log(`[render] starting vite preview on :${PORT}...`);
  // Explicit --host is required: without it vite preview may bind
  // on a non-loopback interface that our local fetch can't reach.
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: ROOT, stdio: 'pipe',
  });
  proc.stdout.on('data', d => process.stdout.write(`[vite] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[vite-err] ${d}`));
  proc.on('exit', code => console.log(`[vite] exited with code=${code}`));
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isLocalPortOpen(PORT)) return proc;
  }
  proc.kill();
  throw new Error(`preview server failed to start within 30s on :${PORT}`);
}

// ── Template loader (browser side) ──────────────────────────────────
// We pass YAML directly into __folio.loadFromYAML, then read the
// rendered SVG element. Element screenshots respect SVG bounds so we
// get the design at native resolution.
async function renderOne(page, entry, outDir) {
  const yamlPath = path.join(TPL_DIR, entry.file);
  const yaml     = await fs.readFile(yamlPath, 'utf8');
  const consoleErrors = [];
  const onErr = msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  page.on('console', onErr);

  const t0 = Date.now();
  const loadResult = await page.evaluate(async (src) => {
    const w = window;
    if (!w.__folio || typeof w.__folio.loadFromYAML !== 'function') {
      return { ok: false, err: '__folio.loadFromYAML missing' };
    }
    try { w.__folio.loadFromYAML(src); }
    catch (e) { return { ok: false, err: String(e?.message ?? e) }; }
    // Wait for async render side-effects to settle: marked, mermaid,
    // chart libs all load lazily and finalise DOM on a later tick.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Pre-trigger font downloads for every (family, size, weight) tuple
    // actually used in this design. document.fonts.ready alone is racy
    // because Google Fonts faces stay "unloaded" until something requests
    // them — by the time the browser sees the SVG text the screenshot may
    // fire first. Explicit document.fonts.load() awaits the binary.
    try {
      const seen = new Set();
      const reqs = [];
      document.querySelectorAll('.canvas-svg-container svg text').forEach(t => {
        const fam = t.getAttribute('font-family');
        const wt  = t.getAttribute('font-weight') || '400';
        const sz  = t.getAttribute('font-size')   || '16';
        const key = `${sz}px ${wt} ${fam}`;
        if (fam && !seen.has(key)) {
          seen.add(key);
          reqs.push(document.fonts.load(`${wt} ${sz}px ${fam}`).catch(() => null));
        }
      });
      await Promise.all(reqs);
      await document.fonts.ready;
    } catch { /* font load API unavailable */ }
    // Poll until any markdown placeholders have been replaced with
    // parsed HTML (or 800ms cap — non-markdown templates fall through).
    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      const pending = document.querySelectorAll(
        '.folio-richtext[data-render-type="markdown"] > span'
      ).length;
      if (pending === 0) break;
      await new Promise(r => setTimeout(r, 50));
    }
    // Settle: document.fonts.ready resolves when the font binary is available,
    // but the SVG <text> repaint with the swapped-in face happens on a LATER
    // frame. Without this delay the screenshot can capture pre-swap glyphs —
    // for heavy display faces (Anton, Audiowide, Bebas) that means large
    // headlines/stats render invisible. Wait two frames + a fixed beat so the
    // font swap has painted before we snapshot.
    await new Promise(r => setTimeout(r, 250));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { ok: true };
  }, yaml);

  if (!loadResult.ok) {
    page.off('console', onErr);
    return { id: entry.id, file: entry.file, status: 'load-error', error: loadResult.err, ms: Date.now() - t0 };
  }

  const svg = await page.locator('.canvas-svg-container svg').first();
  await svg.waitFor({ state: 'attached', timeout: RENDER_TIMEOUT_MS }).catch(() => {});

  // Pull intrinsic SVG size so the output PNG matches the design's
  // native canvas, not the viewport zoom.
  const size = await svg.evaluate(el => ({
    w: Number(el.getAttribute('width')  ?? el.viewBox?.baseVal?.width  ?? 0),
    h: Number(el.getAttribute('height') ?? el.viewBox?.baseVal?.height ?? 0),
    vb: el.getAttribute('viewBox') ?? null,
  })).catch(() => ({ w: 0, h: 0, vb: null }));

  // Element screenshot — Playwright clips to the bounding box, but the
  // SVG is scaled by canvas zoom. We force native size via a temporary
  // CSS override so the screenshot equals the design's pixel canvas.
  await page.evaluate(({ w, h }) => {
    const el = document.querySelector('.canvas-svg-container svg');
    if (!el) return;
    el.setAttribute('width',  String(w));
    el.setAttribute('height', String(h));
    el.style.transform = 'none';
    el.style.transformOrigin = '0 0';
  }, size);

  // Programmatic checks. Heuristic tuning:
  //  - SLOP: ignore sub-pixel float rounding and intentional bleed up
  //    to 8px (decorative shapes commonly cross the edge by a few px).
  //  - BIG_OVERFLOW: only count overflows ≥ 32px as real "off-canvas"
  //    breakage (anything smaller is almost always intentional bleed).
  //  - Text overlap: flag rendered text bboxes that overlap by ≥ 4px
  //    on BOTH axes (genuine visual collision).
  const checks = await page.evaluate(({ w, h }) => {
    const SLOP = 8;
    const BIG_OVERFLOW = 32;
    const svg = document.querySelector('.canvas-svg-container svg');
    if (!svg) return { layers: 0, overflow: 0, offCanvas: 0, textOverlap: 0, empty: true };
    const layers = svg.querySelectorAll('[data-layer-id]');
    let overflow = 0;
    let offCanvas = 0;
    const textBoxes = [];
    layers.forEach(l => {
      try {
        const b = l.getBBox?.();
        if (!b) return;
        if (b.x < -SLOP || b.y < -SLOP) {
          if (b.x < -BIG_OVERFLOW || b.y < -BIG_OVERFLOW) offCanvas++;
        }
        if (b.x + b.width > w + SLOP || b.y + b.height > h + SLOP) {
          if (b.x + b.width > w + BIG_OVERFLOW || b.y + b.height > h + BIG_OVERFLOW) overflow++;
        }
        // Collect text-bearing layers for overlap detection.
        if (l.querySelector('text')) textBoxes.push({ b, id: l.getAttribute('data-layer-id') });
      } catch { /* getBBox unsupported on this node */ }
    });
    // Pairwise overlap: O(n²) but n is small (text layers per design).
    let textOverlap = 0;
    for (let i = 0; i < textBoxes.length; i++) {
      for (let j = i + 1; j < textBoxes.length; j++) {
        const a = textBoxes[i].b, c = textBoxes[j].b;
        const ox = Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x);
        const oy = Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y);
        if (ox > 4 && oy > 4) textOverlap++;
      }
    }
    return {
      layers: layers.length,
      overflow,
      offCanvas,
      textOverlap,
      empty: layers.length === 0,
    };
  }, size);

  const outFile = path.join(outDir, `${entry.id}.png`);
  // Final paint settle after the native-size resize + checks, so the font
  // swap is guaranteed flushed to the compositor before capture.
  await page.waitForTimeout(250);
  await svg.screenshot({ path: outFile, omitBackground: false });

  page.off('console', onErr);
  // Classification: FAIL = empty/load error; WARN = console errors,
  // overflow, or off-canvas geometry; PASS = rendered cleanly.
  let classification = 'pass';
  if (checks.empty) classification = 'fail';
  else if (consoleErrors.length || checks.overflow > 0 || checks.offCanvas > 0 || checks.textOverlap > 0) {
    classification = 'warn';
  }

  return {
    id: entry.id,
    file: entry.file,
    status: consoleErrors.length ? 'rendered-with-errors' : 'ok',
    classification,
    width: size.w,
    height: size.h,
    checks,
    consoleErrors,
    ms: Date.now() - t0,
  };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  let templates;
  if (args.all) {
    const inv = JSON.parse(await fs.readFile(path.join(__dirname, 'inventory.json'), 'utf8'));
    templates = inv.entries;
  } else {
    const listJson = JSON.parse(await fs.readFile(args.list, 'utf8'));
    templates = Array.isArray(listJson) ? listJson : listJson.entries;
  }
  templates = templates.slice(0, args.limit);

  const serverProc = EXTERNAL_BASE ? null : await ensureServer();
  const browser = await chromium.launch({ headless: true });

  // Hide non-canvas chrome on every page — applied once per page below.
  const HIDE_CHROME_CSS = `
    .toolbar, .activity-bar, .left-panel, .properties-panel, .status-bar,
    .formula-bar, .tab-bar-container, .page-strip-section, .toolbar-zoom,
    .minimap-container { display: none !important; }
    .canvas-section { padding: 0 !important; }
  `;

  async function newWorker() {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    const navUrl = AUDIT_TOKEN ? `${BASE_URL}/?token=${encodeURIComponent(AUDIT_TOKEN)}` : `${BASE_URL}/`;
    await page.goto(navUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window).__folio?.loadFromYAML, { timeout: 30_000 });
    await page.addStyleTag({ content: HIDE_CHROME_CSS });
    return { ctx, page };
  }

  console.log(`[render] loading ${args.workers} worker page(s) at ${BASE_URL}/`);
  const workers = await Promise.all(Array.from({ length: args.workers }, newWorker));
  console.log(`[render] workers ready`);

  // Work queue: a shared index pointer so each free worker grabs the
  // next unrendered template.
  const results = new Array(templates.length);
  let nextIdx = 0;
  let done = 0;

  async function workerLoop(worker, wid) {
    while (true) {
      const i = nextIdx++;
      if (i >= templates.length) break;
      const t = templates[i];
      let res;
      try {
        res = await renderOne(worker.page, t, args.outDir);
      } catch (e) {
        res = { id: t.id, file: t.file, status: 'exception', error: String(e?.message ?? e) };
      }
      results[i] = res;
      done++;
      console.log(`[w${wid} ${done}/${templates.length}] ${t.id} ${res.classification ?? res.status} ${res.ms ? `(${res.ms}ms)` : ''}`);
    }
  }

  await Promise.all(workers.map((w, i) => workerLoop(w, i + 1)));

  const reportPath = path.join(args.outDir, 'results.json');
  await fs.writeFile(reportPath, JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));

  const pass = results.filter(r => r.classification === 'pass').length;
  const warn = results.filter(r => r.classification === 'warn').length;
  const fail = results.filter(r => r.classification === 'fail').length;
  const other = results.length - pass - warn - fail;
  console.log(`\n[render] PASS=${pass} WARN=${warn} FAIL=${fail}${other ? ` other=${other}` : ''}`);
  console.log(`[render] results → ${path.relative(ROOT, reportPath)}`);

  await browser.close();
  if (serverProc) serverProc.kill();
}

await main();
