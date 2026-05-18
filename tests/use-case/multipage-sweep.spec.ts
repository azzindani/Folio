/**
 * For every multi-page template in catalog-index, screenshot each page by
 * driving window.__folio.state.set('currentPageIndex', n). Output goes to
 * tools/use-case-reports/multipage-sweep/.
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
} from './_helpers';

interface CatalogEntry { id: string; name: string; type: string; file: string; pages?: number; themeRef?: string }
interface PageResult {
  id: string;
  name: string;
  file: string;
  pages: number;
  pagesRendered: number;
  errors: string[];
  shots: string[];
}

const OUT = path.join(REPORT_ROOT, 'multipage-sweep');
ensureDir(OUT);
ensureDir(path.join(OUT, 'shots'));

const CATALOG = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'src', 'templates', 'catalog-index.json'), 'utf8')
) as { entries: CatalogEntry[] };

const ENTRIES = CATALOG.entries.filter(e => (e.pages ?? 0) >= 2);

test('multipage visual sweep', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const cap = attachConsoleCapture(page);
  const results: PageResult[] = [];

  await page.goto('/');
  await waitForFolioReady(page);

  for (let i = 0; i < ENTRIES.length; i++) {
    const e = ENTRIES[i]!;
    const yamlUrl = `/templates/builtin/${e.file}`;
    const yaml = await page.evaluate(async (u: string) => {
      const r = await fetch(u);
      return r.ok ? await r.text() : null;
    }, yamlUrl);
    if (!yaml) continue;

    cap.errors.length = 0;
    const inj = await loadYAMLIntoEditor(page, yaml);
    if (!inj.ok) continue;
    await page.waitForTimeout(250);

    // Read actual page count from the loaded design (catalog meta might disagree).
    const actualPages = await page.evaluate(() => {
      const f = (window as unknown as { __folio: { state: { get(): { design?: { pages?: unknown[] } } } } }).__folio;
      return f.state.get().design?.pages?.length ?? 0;
    });

    const shots: string[] = [];
    const totalPages = Math.max(actualPages, e.pages ?? 0);

    for (let p = 0; p < totalPages; p++) {
      await page.evaluate((idx: number) => {
        const f = (window as unknown as { __folio: { state: { set(k: string, v: unknown): void } } }).__folio;
        f.state.set('currentPageIndex', idx);
      }, p);
      await page.waitForTimeout(180);
      const shotName = `${safeName(e.id)}-p${String(p + 1).padStart(2, '0')}.png`;
      const shotPath = path.join(OUT, 'shots', shotName);
      await page.locator('.canvas-area').first().screenshot({ path: shotPath }).catch(() => null);
      shots.push(path.relative(REPORT_ROOT, shotPath));
    }

    results.push({
      id: e.id,
      name: e.name,
      file: e.file,
      pages: totalPages,
      pagesRendered: shots.length,
      errors: [...cap.errors],
      shots,
    });

    if ((i + 1) % 20 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[mp-sweep] ${i + 1}/${ENTRIES.length} ${e.id} (${totalPages} pages)`);
      writeJSON(path.join(OUT, 'results.partial.json'), { count: results.length, results });
    }
  }

  writeJSON(path.join(OUT, 'results.json'), { count: results.length, results });

  // Problems = any template where errors > 0 OR pagesRendered < pages.
  const problems = results.filter(r => r.errors.length > 0 || r.pagesRendered < r.pages);
  writeJSON(path.join(OUT, 'problems.json'), {
    total: results.length,
    problemCount: problems.length,
    problems,
  });
});
