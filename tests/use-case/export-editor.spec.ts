/**
 * Editor-driven export sweep.
 *
 * For each of 5 templates spanning 5 distinct design types we drive the
 * editor like a user would: load YAML into the running preview, then trigger
 * SVG via window.__folio.exportSVG() and PNG / PDF / HTML via the toolbar
 * "Export" menu. Outputs are captured through Playwright's download event
 * (the editor uses an anchor-download fallback when showSaveFilePicker is
 * absent, which is exactly the path Playwright sees).
 *
 * Output: tools/use-case-reports/export-editor/{outputs/*, results.json, problems.json}.
 */
import { test, expect, type Download, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  attachConsoleCapture,
  ensureDir,
  loadYAMLIntoEditor,
  REPORT_ROOT,
  waitForFolioReady,
  writeJSON,
} from './_helpers';

interface Combo {
  id: string;          // template id, e.g. "tmpl-simple-poster"
  file: string;        // builtin yaml file (under public/templates/builtin)
  type: string;        // poster / carousel / report / presentation / book
  description: string;
}

interface ResultRow {
  template: string;
  type: string;
  format: 'svg' | 'png' | 'pdf' | 'html';
  ok: boolean;
  reason?: string;
  output_path?: string;
  bytes?: number;
  time_ms: number;
  errors: string[];
}

const COMBOS: Combo[] = [
  { id: 'tmpl-simple-poster',       file: '01-simple-poster.template.yaml',     type: 'poster',       description: 'Square dark-tech poster, 3 text slots' },
  { id: 'tmpl-instagram-carousel',  file: '06-instagram-carousel.template.yaml',type: 'carousel',     description: '4-page Instagram carousel' },
  { id: 'tmpl-sectioned-report',    file: '08-sectioned-report.template.yaml',  type: 'report',       description: '3-page sectioned report' },
  { id: 'tmpl-slide-content',       file: '41-slide-content.template.yaml',     type: 'presentation', description: 'Single-slide presentation' },
  { id: 'tmpl-childrens-book',      file: '167-childrens-book.template.yaml',   type: 'book',         description: '8-page children-book carousel' },
];

const FORMATS: Array<'svg' | 'png' | 'pdf' | 'html'> = ['svg', 'png', 'pdf', 'html'];

const OUT_DIR  = path.join(REPORT_ROOT, 'export-editor');
const FILE_DIR = path.join(OUT_DIR, 'outputs');
ensureDir(OUT_DIR);
ensureDir(FILE_DIR);

// PNG magic bytes
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// PDF magic
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

function assertSVGish(buf: Buffer): { ok: boolean; reason?: string } {
  const s = buf.toString('utf8');
  if (!/<svg[\s>]/i.test(s)) return { ok: false, reason: 'No <svg> element in payload' };
  // At least one child element inside <svg ...>...
  const inner = s.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>[\s\S]*$/i, '');
  if (!/<[a-z]/i.test(inner)) return { ok: false, reason: '<svg> has zero children' };
  return { ok: true };
}

function assertHTMLish(buf: Buffer): { ok: boolean; reason?: string } {
  const s = buf.toString('utf8');
  if (!/<html[\s>]/i.test(s) && !/<!doctype html/i.test(s)) {
    return { ok: false, reason: 'No <html> root / DOCTYPE in payload' };
  }
  if (!/<(svg|div|main|section|body)[\s>]/i.test(s)) {
    return { ok: false, reason: 'HTML has no body content' };
  }
  return { ok: true };
}

function assertPNG(buf: Buffer): { ok: boolean; reason?: string } {
  if (buf.length < 8) return { ok: false, reason: `PNG too small (${buf.length} bytes)` };
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) return { ok: false, reason: `Bad PNG magic: ${buf.subarray(0,8).toString('hex')}` };
  return { ok: true };
}

function assertPDF(buf: Buffer): { ok: boolean; reason?: string } {
  if (buf.length < 5) return { ok: false, reason: `PDF too small (${buf.length} bytes)` };
  if (!buf.subarray(0, 5).equals(PDF_MAGIC)) return { ok: false, reason: `Bad PDF magic: ${buf.subarray(0,8).toString('hex')}` };
  return { ok: true };
}

async function triggerExport(page: Page, format: 'svg' | 'png' | 'pdf' | 'html'): Promise<Download | null> {
  // Force-open the menu via DOM (the click handler can race with outside-click
  // closing the menu we just opened).
  await page.evaluate(() => {
    const menu = document.querySelector('.export-menu') as HTMLElement | null;
    if (menu) menu.style.display = 'block';
  });
  await page.waitForTimeout(50);

  const selector = `.export-item[data-format="${format}"]`;
  const dlPromise = page.waitForEvent('download', { timeout: 45_000 }).catch(() => null);

  // Click via JS dispatch so the outside-click listener does not close
  // the menu before our click reaches the item.
  const dispatched = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);

  if (!dispatched) return null;
  return await dlPromise;
}

test.describe.configure({ mode: 'serial' });

test('editor export sweep across 5 templates × 4 formats', async ({ page, context }) => {
  test.setTimeout(10 * 60_000);
  // Permit downloads. acceptDownloads is default true.
  await context.grantPermissions([]).catch(() => null);

  const cap = attachConsoleCapture(page);
  const results: ResultRow[] = [];

  // Stub showSaveFilePicker BEFORE the page loads — the exporter caches the
  // capability check, so we must delete it pre-script-eval to force the
  // anchor-download fallback that Playwright observes.
  await page.addInitScript(() => {
    try { delete (window as unknown as Record<string, unknown>)['showSaveFilePicker']; } catch { /* noop */ }
  });
  await page.goto('/');
  await waitForFolioReady(page);
  await page.waitForTimeout(300);

  for (const tmpl of COMBOS) {
    // Fetch yaml from preview.
    const yaml = await page.evaluate(async (u: string) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`fetch ${u} -> ${r.status}`);
      return await r.text();
    }, `/templates/builtin/${tmpl.file}`).catch(err => {
      // eslint-disable-next-line no-console
      console.warn(`[editor] fetch failed for ${tmpl.file}: ${(err as Error).message}`);
      return '';
    });

    if (!yaml) {
      for (const fmt of FORMATS) {
        results.push({ template: tmpl.id, type: tmpl.type, format: fmt, ok: false, reason: 'template fetch failed', time_ms: 0, errors: [] });
      }
      continue;
    }

    const inj = await loadYAMLIntoEditor(page, yaml);
    await page.waitForTimeout(500);
    if (!inj.ok) {
      for (const fmt of FORMATS) {
        results.push({ template: tmpl.id, type: tmpl.type, format: fmt, ok: false, reason: `load failed: ${inj.error ?? '?'}`, time_ms: 0, errors: [] });
      }
      continue;
    }

    for (const fmt of FORMATS) {
      cap.errors.length = 0;
      const start = Date.now();
      let ok = false;
      let reason: string | undefined;
      let outPath: string | undefined;
      let bytes: number | undefined;

      try {
        let buf: Buffer | null = null;

        if (fmt === 'svg') {
          // Fast path: window.__folio.exportSVG() returns the serialized SVG string.
          const svgString = await page.evaluate(() => {
            const f = (window as unknown as { __folio: { exportSVG(): string } }).__folio;
            return f.exportSVG();
          });
          buf = Buffer.from(svgString, 'utf8');
        } else {
          // Toolbar export menu → Playwright catches the resulting download.
          const dl = await triggerExport(page, fmt);
          if (!dl) {
            reason = `Toolbar export click produced no download (${fmt})`;
          } else {
            const saveTo = path.join(FILE_DIR, `${tmpl.id}.${fmt}`);
            await dl.saveAs(saveTo).catch((err: Error) => { reason = `saveAs failed: ${err.message}`; });
            if (!reason && fs.existsSync(saveTo)) {
              buf = fs.readFileSync(saveTo);
            }
          }
        }

        if (buf) {
          outPath = path.join(FILE_DIR, `${tmpl.id}.${fmt}`);
          fs.writeFileSync(outPath, buf);
          bytes = buf.length;

          if (bytes < 100) {
            reason = `Output too small (${bytes} bytes)`;
          } else {
            let v: { ok: boolean; reason?: string };
            if (fmt === 'svg') v = assertSVGish(buf);
            else if (fmt === 'html') v = assertHTMLish(buf);
            else if (fmt === 'png') v = assertPNG(buf);
            else /* pdf */          v = assertPDF(buf);
            ok = v.ok;
            if (!ok) reason = v.reason;
          }
        } else if (!reason) {
          reason = 'No output captured';
        }
      } catch (err) {
        reason = `Exception: ${(err as Error).message}`;
      }

      results.push({
        template: tmpl.id,
        type: tmpl.type,
        format: fmt,
        ok,
        reason,
        output_path: outPath,
        bytes,
        time_ms: Date.now() - start,
        errors: [...cap.errors],
      });

      // Defensive: small gap so the toolbar can settle.
      await page.waitForTimeout(150);
    }
  }

  writeJSON(path.join(OUT_DIR, 'results.json'), {
    count: results.length,
    pass: results.filter(r => r.ok).length,
    fail: results.filter(r => !r.ok).length,
    results,
  });
  writeJSON(path.join(OUT_DIR, 'problems.json'), {
    count: results.filter(r => !r.ok).length,
    problems: results.filter(r => !r.ok),
  });

  // Don't fail the test even if some exports broke — we *want* the data.
  expect(results.length).toBe(COMBOS.length * FORMATS.length);
});
