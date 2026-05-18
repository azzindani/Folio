/**
 * Visual sweep across every builtin template. For each entry in
 * src/templates/catalog-index.json:
 *  1. Fetch the YAML.
 *  2. Inject it into the live editor via window.__folio.loadFromYAML.
 *  3. Wait for the canvas to settle, screenshot the canvas.
 *  4. Capture console errors + page errors.
 * Output goes to tools/use-case-reports/template-sweep/.
 */
import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  attachConsoleCapture,
  ensureDir,
  loadYAMLIntoEditor,
  REPORT_ROOT,
  safeName,
  waitForFolioReady,
  writeJSON,
  type Note,
} from './_helpers';

interface CatalogEntry {
  id: string;
  name: string;
  type: string;
  file: string;
  themeRef?: string;
  width?: number;
  height?: number;
  pages?: number;
}

interface SweepResult {
  id: string;
  name: string;
  file: string;
  type: string;
  themeRef?: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  loadMs: number;
  renderMs: number;
  screenshot: string;
}

const OUT = path.join(REPORT_ROOT, 'template-sweep');
ensureDir(OUT);
ensureDir(path.join(OUT, 'shots'));

const CATALOG_PATH = path.join(process.cwd(), 'src', 'templates', 'catalog-index.json');
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as { entries: CatalogEntry[] };

// Optional slice via env var, e.g. SWEEP_SLICE=0:50 to run first 50.
const slice = process.env['SWEEP_SLICE'];
const [from, to] = slice ? slice.split(':').map(Number) : [0, CATALOG.entries.length];
const ENTRIES = CATALOG.entries.slice(from, to);

test.describe.configure({ mode: 'serial' });

test('template visual sweep', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const results: SweepResult[] = [];
  const notes: Note[] = [];
  const cap = attachConsoleCapture(page);

  await page.goto('/');
  await waitForFolioReady(page);
  await page.waitForTimeout(400);

  for (let i = 0; i < ENTRIES.length; i++) {
    const e = ENTRIES[i]!;
    const yamlUrl = `/templates/builtin/${e.file}`;
    const loadStart = Date.now();
    const yaml = await page.evaluate(async (u: string) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`fetch ${u} → ${r.status}`);
      return await r.text();
    }, yamlUrl).catch((err: Error) => {
      notes.push({ step: `fetch:${e.id}`, severity: 'error', msg: err.message });
      return null;
    });
    if (!yaml) continue;

    // Reset console buffer per template.
    cap.errors.length = 0;
    cap.warnings.length = 0;

    const renderStart = Date.now();
    const inj = await loadYAMLIntoEditor(page, yaml);
    if (!inj.ok) {
      notes.push({ step: `load:${e.id}`, severity: 'error', msg: inj.error ?? 'unknown' });
    }
    // Allow async theme/typepack/effects to land + animations to settle.
    await page.waitForTimeout(350);
    const renderMs = Date.now() - renderStart;

    const shotName = `${safeName(e.id)}.png`;
    const shotPath = path.join(OUT, 'shots', shotName);
    await page.locator('.canvas-area').first().screenshot({ path: shotPath }).catch(() => null);

    results.push({
      id: e.id,
      name: e.name,
      file: e.file,
      type: e.type,
      themeRef: e.themeRef,
      ok: inj.ok && cap.errors.length === 0,
      errors: [...cap.errors],
      warnings: [...cap.warnings],
      loadMs: renderStart - loadStart,
      renderMs,
      screenshot: path.relative(REPORT_ROOT, shotPath),
    });

    if ((i + 1) % 25 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[sweep] ${i + 1}/${ENTRIES.length} (${e.id})`);
      writeJSON(path.join(OUT, 'results.partial.json'), { count: results.length, results });
    }
  }

  writeJSON(path.join(OUT, 'results.json'), { count: results.length, results });
  writeJSON(path.join(OUT, 'notes.json'), notes);

  // Build a problems-only digest for fast scanning.
  const problems = results.filter(r => !r.ok || r.errors.length > 0);
  writeJSON(path.join(OUT, 'problems.json'), {
    total: results.length,
    problemCount: problems.length,
    problems,
  });
});
