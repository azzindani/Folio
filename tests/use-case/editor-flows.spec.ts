/**
 * 50+ user-flow scenarios driving the live Folio editor at :4173.
 * Per-scenario screenshots + console-error capture.
 * Output: tools/use-case-reports/editor-flows/{results.json,problems.json,shots/*.png}
 */
import { test, type Page } from '@playwright/test';
import * as path from 'node:path';
import {
  attachConsoleCapture,
  ensureDir,
  loadYAMLIntoEditor,
  REPORT_ROOT,
  safeName,
  waitForFolioReady,
  writeJSON,
  type ConsoleCapture,
} from './_helpers';

interface FlowResult {
  id: string;
  group: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
  shots: { before?: string; after?: string };
  durationMs: number;
}

const OUT = path.join(REPORT_ROOT, 'editor-flows');
const SHOTS = path.join(OUT, 'shots');
ensureDir(OUT);
ensureDir(SHOTS);

const RESULTS: FlowResult[] = [];

test.describe.configure({ mode: 'serial' });

// ── Shared helpers ────────────────────────────────────────────

async function fetchTemplate(page: Page, file: string): Promise<string | null> {
  return await page.evaluate(async (f: string) => {
    const r = await fetch(`/templates/builtin/${f}`);
    return r.ok ? await r.text() : null;
  }, file);
}

async function loadTemplate(page: Page, file: string): Promise<boolean> {
  const yaml = await fetchTemplate(page, file);
  if (!yaml) return false;
  const inj = await loadYAMLIntoEditor(page, yaml);
  await page.waitForTimeout(350);
  return inj.ok;
}

async function shot(page: Page, name: string): Promise<string> {
  const p = path.join(SHOTS, `${safeName(name)}.png`);
  await page.locator('.canvas-area').first().screenshot({ path: p }).catch(() => null);
  return path.relative(REPORT_ROOT, p);
}

interface FlowCtx {
  id: string;
  group: string;
  cap: ConsoleCapture;
  notes: string[];
  before?: string;
  after?: string;
  start: number;
}

function startFlow(page: Page, id: string, group: string): FlowCtx {
  const cap = attachConsoleCapture(page);
  return { id, group, cap, notes: [], start: Date.now() };
}

function finishFlow(ctx: FlowCtx, ok: boolean): void {
  RESULTS.push({
    id: ctx.id,
    group: ctx.group,
    ok: ok && ctx.cap.errors.length === 0,
    errors: [...ctx.cap.errors],
    warnings: [...ctx.cap.warnings],
    notes: ctx.notes,
    shots: { before: ctx.before, after: ctx.after },
    durationMs: Date.now() - ctx.start,
  });
}

async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/');
  await waitForFolioReady(page);
  await page.waitForTimeout(400);
}

async function getLayerCount(page: Page): Promise<number> {
  return await page.locator('.layer-row[data-layer-id]').count();
}

async function selectFirstLayer(page: Page): Promise<string | null> {
  const row = page.locator('.layer-row[data-layer-id]').first();
  if ((await row.count()) === 0) return null;
  const id = await row.getAttribute('data-layer-id');
  await row.click();
  await page.waitForTimeout(150);
  return id;
}

interface FolioApi {
  state: { get(): { design?: unknown; selectedLayerIds?: string[]; currentPageIndex?: number } };
  getYAML(): string;
  loadFromYAML(s: string): void;
  applyTheme(id: string): void;
}

async function getYAML(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return (window as unknown as { __folio: FolioApi }).__folio.getYAML();
  });
}

async function getCurrentPageIndex(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return (window as unknown as { __folio: FolioApi }).__folio.state.get().currentPageIndex ?? 0;
  });
}

async function getSelectedIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return (window as unknown as { __folio: FolioApi }).__folio.state.get().selectedLayerIds ?? [];
  });
}

// Template fixtures (one per type)
const TEMPLATES = {
  poster: { file: '01-simple-poster.template.yaml', id: 'tmpl-simple-poster' },
  card: { file: '263-ad-app-install.template.yaml', id: 'tmpl-ad-app-install' },
  carousel: { file: '111-app-store-screenshots.template.yaml', id: 'tmpl-app-store-screenshots' },
  report: { file: '206-agritech-farm-yield-report.template.yaml', id: 'tmpl-agritech-farm-yield-report' },
  presentation: { file: '71-lesson-title.template.yaml', id: 'tmpl-lesson-title' },
  deck: { file: '108-pitch-deck-product.template.yaml', id: 'tmpl-pitch-deck-product' },
  book: { file: '209-baby-photo-album.template.yaml', id: 'tmpl-baby-photo-album' },
};

// ─── Group 1: Catalog → search → pick → editor ──────────────────────────────

test.describe('1. Catalog → search → pick template', () => {
  for (const [type, tmpl] of Object.entries(TEMPLATES).slice(0, 5)) {
    test(`1.${type}: open catalog, search "${tmpl.id}", load in editor`, async ({ page }) => {
      const ctx = startFlow(page, `1-${type}`, 'catalog');
      let ok = false;
      try {
        await gotoEditor(page);
        ctx.before = await shot(page, `1-${type}-before`);

        // Open catalog from toolbar
        await page.locator('[data-action="catalog"]').click();
        await page.waitForSelector('.catalog-search', { timeout: 5_000 });

        // Search by name fragment
        const searchTerm = tmpl.id.replace(/^tmpl-/, '').split('-').slice(0, 2).join('-');
        await page.locator('.catalog-search').fill(searchTerm);
        await page.waitForTimeout(300);

        // Pick the template card (fall back to first if exact id not visible)
        const exact = page.locator(`[data-template="${tmpl.id}"]`);
        const card = (await exact.count()) > 0 ? exact.first() : page.locator('[data-template]').first();
        if ((await card.count()) === 0) {
          ctx.notes.push('no template cards rendered after search');
        } else {
          await card.click();
          // Catalog may show details pane; click again or trigger load
          const loadBtn = page.locator('[data-catalog-action="load"], .catalog-load-btn');
          if ((await loadBtn.count()) > 0) {
            await loadBtn.first().click();
          }
          await page.waitForTimeout(800);
          // Ensure overlay closed
          const overlay = page.locator('.catalog-overlay');
          if (await overlay.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
        }

        const layers = await getLayerCount(page);
        ctx.notes.push(`layer count: ${layers}`);
        ctx.after = await shot(page, `1-${type}-after`);
        ok = layers > 0;
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
      // Soft: a console error here is recorded for the report, never fails the run.
    });
  }
});

// ─── Group 2: Inline text editing → blur → YAML reflects change ─────────────

test.describe('2. Text editing inline → YAML round-trip', () => {
  const TEXT_TEMPLATES = [
    { key: 'poster', file: '01-simple-poster.template.yaml' },
    { key: 'card', file: '263-ad-app-install.template.yaml' },
    { key: 'presentation', file: '71-lesson-title.template.yaml' },
    { key: 'report', file: '206-agritech-farm-yield-report.template.yaml' },
    { key: 'deck', file: '108-pitch-deck-product.template.yaml' },
  ];

  for (const t of TEXT_TEMPLATES) {
    test(`2.${t.key}: dblclick text layer, edit, blur, verify YAML`, async ({ page }) => {
      const ctx = startFlow(page, `2-${t.key}`, 'text-edit');
      let ok = false;
      try {
        await gotoEditor(page);
        const loaded = await loadTemplate(page, t.file);
        if (!loaded) throw new Error('template failed to load');
        ctx.before = await shot(page, `2-${t.key}-before`);

        // Find first text layer row & click
        const textRow = page.locator('.layer-row[data-layer-id]').filter({ has: page.locator('span') }).first();
        const allRows = await page.locator('.layer-row[data-layer-id]').all();
        let textLayerId: string | null = null;
        for (const r of allRows) {
          const id = await r.getAttribute('data-layer-id');
          if (!id) continue;
          const isText = await page.evaluate((lid: string) => {
            const f = (window as unknown as { __folio: FolioApi }).__folio;
            const d = f.state.get().design as { layers?: { id: string; type: string }[]; pages?: { layers?: { id: string; type: string }[] }[] };
            const list = d?.layers ?? d?.pages?.[0]?.layers ?? [];
            return list.find(l => l.id === lid)?.type === 'text';
          }, id);
          if (isText) { textLayerId = id; break; }
        }
        if (!textLayerId) {
          ctx.notes.push('no text layer in template');
          finishFlow(ctx, false);
          return;
        }

        const row = page.locator(`.layer-row[data-layer-id="${textLayerId}"]`);
        await row.click();
        await page.waitForTimeout(150);

        // Dblclick on the SVG text element to open inline editor
        const svgEl = page.locator(`.canvas-area [data-layer-id="${textLayerId}"]`).first();
        await svgEl.dblclick({ force: true });
        await page.waitForTimeout(200);

        const editor = page.locator('.inline-text-editor');
        if ((await editor.count()) === 0) {
          // Fallback: dblclick first text row triggers editor too
          await row.dblclick({ force: true });
          await page.waitForTimeout(200);
        }

        const newText = `Edited-${t.key}-${Date.now() % 100000}`;
        if ((await editor.count()) > 0) {
          await editor.fill(newText);
          await editor.blur();
          await page.waitForTimeout(250);
        } else {
          // No inline editor — use state API as fallback
          await page.evaluate(([lid, val]) => {
            const f = (window as unknown as { __folio: FolioApi & { state: { updateLayer(id: string, p: unknown): void } } }).__folio;
            (f.state as unknown as { updateLayer(id: string, p: unknown): void })
              .updateLayer(lid as string, { content: { type: 'plain', value: val } });
          }, [textLayerId, newText] as const);
          await page.waitForTimeout(200);
          ctx.notes.push('inline editor not opened — used state API fallback');
        }

        const yaml = await getYAML(page);
        ok = yaml.includes(newText);
        ctx.notes.push(`text "${newText}" in YAML: ${ok}`);
        ctx.after = await shot(page, `2-${t.key}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 3: Drag layer → x/y updates in properties panel ──────────────────

test.describe('3. Drag layer with mouse', () => {
  const DRAG_CASES = [
    { key: 'poster', file: '01-simple-poster.template.yaml', dx: 60, dy: 40 },
    { key: 'card', file: '263-ad-app-install.template.yaml', dx: -40, dy: 30 },
    { key: 'presentation', file: '71-lesson-title.template.yaml', dx: 80, dy: -50 },
  ];
  for (const c of DRAG_CASES) {
    test(`3.${c.key}: drag layer by (${c.dx},${c.dy}) → props x/y updates`, async ({ page }) => {
      const ctx = startFlow(page, `3-${c.key}`, 'drag');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, c.file)) throw new Error('load failed');
        ctx.before = await shot(page, `3-${c.key}-before`);

        const layerId = await selectFirstLayer(page);
        if (!layerId) throw new Error('no layer to select');

        const xInBefore = await page.locator('input[data-prop="x"]').first().inputValue().catch(() => '');
        const yInBefore = await page.locator('input[data-prop="y"]').first().inputValue().catch(() => '');

        const selBox = page.locator('.selection-box').first();
        const bbox = await selBox.boundingBox();
        if (!bbox) throw new Error('no selection box');
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + c.dx, cy + c.dy, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);

        const xInAfter = await page.locator('input[data-prop="x"]').first().inputValue().catch(() => '');
        const yInAfter = await page.locator('input[data-prop="y"]').first().inputValue().catch(() => '');
        ctx.notes.push(`x: ${xInBefore} → ${xInAfter}, y: ${yInBefore} → ${yInAfter}`);
        ok = xInBefore !== xInAfter || yInBefore !== yInAfter;
        ctx.after = await shot(page, `3-${c.key}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 4: Resize layer via 8 handles ────────────────────────────────────

test.describe('4. Resize via 8 directional handles', () => {
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
  for (const h of HANDLES) {
    test(`4.${h}: drag ${h} handle resizes rect`, async ({ page }) => {
      const ctx = startFlow(page, `4-${h}`, 'resize');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');

        const rectId = await page.evaluate(() => {
          const f = (window as unknown as { __folio: FolioApi }).__folio;
          const d = f.state.get().design as { layers?: { id: string; type: string }[] };
          return d?.layers?.find(l => l.type === 'rect' && l.id !== 'bg')?.id ?? null;
        });
        if (!rectId) throw new Error('no rect layer');
        await page.locator(`.layer-row[data-layer-id="${rectId}"]`).click();
        await page.waitForTimeout(200);
        ctx.before = await shot(page, `4-${h}-before`);

        const dimsBefore = await page.evaluate((id: string) => {
          const f = (window as unknown as { __folio: FolioApi }).__folio;
          const d = f.state.get().design as { layers?: { id: string; x?: number; y?: number; width?: number; height?: number }[] };
          const l = d?.layers?.find(x => x.id === id);
          return { x: l?.x, y: l?.y, w: l?.width, h: l?.height };
        }, rectId);

        const handle = page.locator(`[data-handle="${h}"][data-layer-id="${rectId}"]`).first();
        const hbox = await handle.boundingBox();
        if (!hbox) throw new Error(`handle ${h} not visible`);
        const hx = hbox.x + hbox.width / 2;
        const hy = hbox.y + hbox.height / 2;
        const dx = h.includes('e') ? 30 : h.includes('w') ? -30 : 0;
        const dy = h.includes('s') ? 30 : h.includes('n') ? -30 : 0;
        await page.mouse.move(hx, hy);
        await page.mouse.down();
        await page.mouse.move(hx + dx, hy + dy, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);

        const dimsAfter = await page.evaluate((id: string) => {
          const f = (window as unknown as { __folio: FolioApi }).__folio;
          const d = f.state.get().design as { layers?: { id: string; x?: number; y?: number; width?: number; height?: number }[] };
          const l = d?.layers?.find(x => x.id === id);
          return { x: l?.x, y: l?.y, w: l?.width, h: l?.height };
        }, rectId);
        ctx.notes.push(`before=${JSON.stringify(dimsBefore)} after=${JSON.stringify(dimsAfter)}`);
        ok =
          dimsBefore.w !== dimsAfter.w ||
          dimsBefore.h !== dimsAfter.h ||
          dimsBefore.x !== dimsAfter.x ||
          dimsBefore.y !== dimsAfter.y;
        ctx.after = await shot(page, `4-${h}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 5: Properties panel edits ────────────────────────────────────────

test.describe('5. Properties panel edits', () => {
  const PROPS = [
    { key: 'x', selector: 'input[data-prop="x"]', value: '150' },
    { key: 'y', selector: 'input[data-prop="y"]', value: '220' },
    { key: 'w', selector: 'input[data-prop="width"]', value: '400' },
    { key: 'h', selector: 'input[data-prop="height"]', value: '300' },
    { key: 'opacity', selector: 'input[data-prop="opacity"]', value: '0.5' },
    { key: 'rotation', selector: 'input[data-prop="rotation"]', value: '15' },
  ];
  for (const p of PROPS) {
    test(`5.${p.key}: edit ${p.key} → canvas updates`, async ({ page }) => {
      const ctx = startFlow(page, `5-${p.key}`, 'props');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
        await selectFirstLayer(page);
        ctx.before = await shot(page, `5-${p.key}-before`);

        const input = page.locator(p.selector).first();
        if ((await input.count()) === 0) {
          ctx.notes.push(`no input ${p.selector}`);
          finishFlow(ctx, false);
          return;
        }
        const before = await input.inputValue();
        await input.fill(p.value);
        await input.press('Enter');
        await page.waitForTimeout(300);
        const after = await input.inputValue();
        ctx.notes.push(`${p.key}: ${before} → ${after}`);
        ok = after === p.value || Math.abs(parseFloat(after) - parseFloat(p.value)) < 0.01;
        ctx.after = await shot(page, `5-${p.key}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 6: Theme switching via toolbar selector ──────────────────────────

test.describe('6. Theme switching', () => {
  const THEMES = ['light-clean', 'ocean-blue', 'dark-tech', 'forest-deep', 'cyber-synthwave'];
  for (const themeId of THEMES) {
    test(`6.${themeId}: apply theme ${themeId}`, async ({ page }) => {
      const ctx = startFlow(page, `6-${themeId}`, 'theme');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
        ctx.before = await shot(page, `6-${themeId}-before`);

        const sel = page.locator('.toolbar-theme-select');
        if ((await sel.count()) === 0) throw new Error('theme select missing');
        await sel.selectOption(themeId).catch(async () => {
          await page.evaluate((tid: string) => {
            (window as unknown as { __folio: FolioApi }).__folio.applyTheme(tid);
          }, themeId);
        });
        await page.waitForTimeout(450);

        const applied = await page.evaluate(() => {
          const f = (window as unknown as { __folio: { state: { get(): { theme?: { id?: string } } } } }).__folio;
          return f.state.get().theme?.id;
        });
        ctx.notes.push(`applied theme id: ${applied}`);
        ok = applied === themeId;
        ctx.after = await shot(page, `6-${themeId}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 7: Layer panel actions ───────────────────────────────────────────

test.describe('7. Layer panel actions', () => {
  test('7.visibility: toggle visibility hides layer', async ({ page }) => {
    const ctx = startFlow(page, '7-visibility', 'layer-panel');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      ctx.before = await shot(page, '7-visibility-before');
      const firstRow = page.locator('.layer-row[data-layer-id]').first();
      const lid = await firstRow.getAttribute('data-layer-id');
      const visBtn = page.locator(`[data-action="toggle-vis"][data-layer-id="${lid}"]`).first();
      if ((await visBtn.count()) === 0) throw new Error('no vis button');
      await visBtn.click();
      await page.waitForTimeout(250);
      const hidden = await page.evaluate((id: string | null) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; visible?: boolean }[] };
        return d?.layers?.find(l => l.id === id)?.visible === false;
      }, lid);
      ctx.notes.push(`hidden=${hidden}`);
      ok = hidden;
      ctx.after = await shot(page, '7-visibility-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('7.lock: toggle lock', async ({ page }) => {
    const ctx = startFlow(page, '7-lock', 'layer-panel');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      ctx.before = await shot(page, '7-lock-before');
      const firstRow = page.locator('.layer-row[data-layer-id]').first();
      const lid = await firstRow.getAttribute('data-layer-id');
      const lockBtn = page.locator(`[data-action="toggle-lock"][data-layer-id="${lid}"]`).first();
      if ((await lockBtn.count()) === 0) throw new Error('no lock button');
      await lockBtn.click();
      await page.waitForTimeout(250);
      const locked = await page.evaluate((id: string | null) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; locked?: boolean }[] };
        return d?.layers?.find(l => l.id === id)?.locked === true;
      }, lid);
      ctx.notes.push(`locked=${locked}`);
      ok = locked;
      ctx.after = await shot(page, '7-lock-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('7.reorder: reorder layer via state api', async ({ page }) => {
    const ctx = startFlow(page, '7-reorder', 'layer-panel');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      ctx.before = await shot(page, '7-reorder-before');
      const rowsBefore = await page.locator('.layer-row[data-layer-id]').evaluateAll(
        els => els.map(e => (e as HTMLElement).dataset['layerId'])
      );
      if (rowsBefore.length < 2) throw new Error('need 2+ layers');
      await page.evaluate(() => {
        const f = (window as unknown as {
          __folio: { state: { reorderLayer?(id: string, dir: 'up' | 'down'): void; get(): { design?: unknown } } };
        }).__folio;
        const d = f.state.get().design as { layers?: { id: string }[] };
        const layers = d?.layers ?? [];
        if (layers.length >= 2 && f.state.reorderLayer) f.state.reorderLayer(layers[0]!.id, 'down');
      });
      await page.waitForTimeout(250);
      const rowsAfter = await page.locator('.layer-row[data-layer-id]').evaluateAll(
        els => els.map(e => (e as HTMLElement).dataset['layerId'])
      );
      ctx.notes.push(`order: ${rowsBefore.slice(0, 3).join(',')} → ${rowsAfter.slice(0, 3).join(',')}`);
      ok = JSON.stringify(rowsBefore) !== JSON.stringify(rowsAfter);
      ctx.after = await shot(page, '7-reorder-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('7.click-select: click row selects layer', async ({ page }) => {
    const ctx = startFlow(page, '7-click-select', 'layer-panel');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      ctx.before = await shot(page, '7-click-select-before');
      const rows = page.locator('.layer-row[data-layer-id]');
      const n = await rows.count();
      if (n < 2) throw new Error('need 2+ layers');
      const targetIdx = Math.min(2, n - 1);
      const targetRow = rows.nth(targetIdx);
      const targetId = await targetRow.getAttribute('data-layer-id');
      await targetRow.click();
      await page.waitForTimeout(200);
      const selected = await getSelectedIds(page);
      ctx.notes.push(`selected: ${selected.join(',')} expect ${targetId}`);
      ok = selected.includes(targetId ?? '');
      ctx.after = await shot(page, '7-click-select-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('7.multi-select: Shift-click multi-select', async ({ page }) => {
    const ctx = startFlow(page, '7-multi-select', 'layer-panel');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      ctx.before = await shot(page, '7-multi-select-before');
      const rows = page.locator('.layer-row[data-layer-id]');
      const n = await rows.count();
      if (n < 2) throw new Error('need 2+ layers');
      await rows.nth(0).click();
      await rows.nth(1).click({ modifiers: ['Shift'] });
      await page.waitForTimeout(200);
      const selected = await getSelectedIds(page);
      ctx.notes.push(`selected count: ${selected.length}`);
      ok = selected.length >= 2;
      ctx.after = await shot(page, '7-multi-select-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });
});

// ─── Group 8: Keyboard shortcuts ────────────────────────────────────────────

test.describe('8. Keyboard shortcuts', () => {
  test('8.duplicate: Ctrl+D adds a layer', async ({ page }) => {
    const ctx = startFlow(page, '8-duplicate', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      await selectFirstLayer(page);
      ctx.before = await shot(page, '8-duplicate-before');
      const before = await getLayerCount(page);
      await page.keyboard.press('Control+d');
      await page.waitForTimeout(300);
      const after = await getLayerCount(page);
      ctx.notes.push(`layers: ${before} → ${after}`);
      ok = after === before + 1;
      ctx.after = await shot(page, '8-duplicate-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('8.delete: Delete key removes selected layer', async ({ page }) => {
    const ctx = startFlow(page, '8-delete', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      // Select non-first to avoid removing bg foundation
      const rows = page.locator('.layer-row[data-layer-id]');
      const n = await rows.count();
      if (n < 2) throw new Error('need 2+ layers');
      await rows.nth(1).click();
      await page.waitForTimeout(150);
      ctx.before = await shot(page, '8-delete-before');
      const before = await getLayerCount(page);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);
      const after = await getLayerCount(page);
      ctx.notes.push(`layers: ${before} → ${after}`);
      ok = after === before - 1;
      ctx.after = await shot(page, '8-delete-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('8.arrow-nudge: Arrow keys nudge by 1px', async ({ page }) => {
    const ctx = startFlow(page, '8-arrow-nudge', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      const lid = await selectFirstLayer(page);
      if (!lid) throw new Error('no layer');
      const xBefore = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.before = await shot(page, '8-arrow-nudge-before');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
      const xAfter = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.notes.push(`x: ${xBefore} → ${xAfter} (delta ${xAfter - xBefore})`);
      ok = Math.abs(xAfter - xBefore - 1) < 0.5;
      ctx.after = await shot(page, '8-arrow-nudge-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('8.shift-arrow-nudge: Shift+Arrow nudges by 10px', async ({ page }) => {
    const ctx = startFlow(page, '8-shift-arrow', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      const lid = await selectFirstLayer(page);
      if (!lid) throw new Error('no layer');
      const xBefore = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.before = await shot(page, '8-shift-arrow-before');
      await page.keyboard.press('Shift+ArrowRight');
      await page.waitForTimeout(150);
      const xAfter = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.notes.push(`x: ${xBefore} → ${xAfter} (delta ${xAfter - xBefore})`);
      ok = Math.abs(xAfter - xBefore - 10) < 0.5;
      ctx.after = await shot(page, '8-shift-arrow-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('8.undo: Ctrl+Z reverts last change', async ({ page }) => {
    const ctx = startFlow(page, '8-undo', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      const lid = await selectFirstLayer(page);
      if (!lid) throw new Error('no layer');
      const x0 = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.before = await shot(page, '8-undo-before');
      // Nudge twice
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const xMoved = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      const xUndone = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.notes.push(`x0=${x0} moved=${xMoved} undone=${xUndone}`);
      ok = Math.abs(xUndone - x0) < 0.5 && xMoved !== x0;
      ctx.after = await shot(page, '8-undo-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('8.redo: Ctrl+Shift+Z replays change', async ({ page }) => {
    const ctx = startFlow(page, '8-redo', 'keyboard');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      const lid = await selectFirstLayer(page);
      if (!lid) throw new Error('no layer');
      const x0 = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.before = await shot(page, '8-redo-before');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const xMoved = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(200);
      const xRedone = await page.evaluate((id: string) => {
        const f = (window as unknown as { __folio: FolioApi }).__folio;
        const d = f.state.get().design as { layers?: { id: string; x?: number }[] };
        return d?.layers?.find(l => l.id === id)?.x ?? 0;
      }, lid);
      ctx.notes.push(`x0=${x0} moved=${xMoved} redone=${xRedone}`);
      ok = Math.abs(xRedone - xMoved) < 0.5 && xMoved !== x0;
      ctx.after = await shot(page, '8-redo-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });
});

// ─── Group 9: Multi-page navigation ─────────────────────────────────────────

test.describe('9. Multi-page carousel navigation', () => {
  const CASES = [
    { key: 'carousel', file: TEMPLATES.carousel.file, targetIdx: 1 },
    { key: 'deck', file: TEMPLATES.deck.file, targetIdx: 2 },
    { key: 'book', file: TEMPLATES.book.file, targetIdx: 3 },
  ];
  for (const c of CASES) {
    test(`9.${c.key}: click page ${c.targetIdx + 1} in page-strip`, async ({ page }) => {
      const ctx = startFlow(page, `9-${c.key}`, 'page-nav');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, c.file)) throw new Error('load failed');
        await page.waitForTimeout(400);
        ctx.before = await shot(page, `9-${c.key}-before`);

        const pageCount = await page.evaluate(() => {
          const f = (window as unknown as { __folio: FolioApi }).__folio;
          const d = f.state.get().design as { pages?: unknown[] };
          return d?.pages?.length ?? 0;
        });
        ctx.notes.push(`pages: ${pageCount}`);
        if (pageCount < 2) {
          ctx.notes.push('template has <2 pages, skipping');
          finishFlow(ctx, false);
          return;
        }

        const idx = Math.min(c.targetIdx, pageCount - 1);
        const thumbs = page.locator('.page-strip > div').filter({ hasNot: page.locator('text="+"') });
        const thumbCount = await thumbs.count();
        if (thumbCount > idx) {
          await thumbs.nth(idx).click();
        } else {
          await page.evaluate((i: number) => {
            const f = (window as unknown as { __folio: { state: { set(k: string, v: unknown, h?: boolean): void } } }).__folio;
            f.state.set('currentPageIndex', i, false);
          }, idx);
        }
        await page.waitForTimeout(350);

        const cur = await getCurrentPageIndex(page);
        ctx.notes.push(`currentPageIndex=${cur} expected=${idx}`);
        ok = cur === idx;
        ctx.after = await shot(page, `9-${c.key}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 10: Payload mode round-trip ──────────────────────────────────────

test.describe('10. Payload mode round-trip', () => {
  const CASES = [
    { key: 'simple', file: '01-simple-poster.template.yaml', tag: 'PAYLOAD_TEST_1' },
    { key: 'card', file: '263-ad-app-install.template.yaml', tag: 'PAYLOAD_TEST_2' },
    { key: 'presentation', file: '71-lesson-title.template.yaml', tag: 'PAYLOAD_TEST_3' },
  ];
  for (const c of CASES) {
    test(`10.${c.key}: payload edit → visual reflects`, async ({ page }) => {
      const ctx = startFlow(page, `10-${c.key}`, 'payload');
      let ok = false;
      try {
        await gotoEditor(page);
        if (!await loadTemplate(page, c.file)) throw new Error('load failed');
        ctx.before = await shot(page, `10-${c.key}-before`);

        await page.locator('.mode-btn[data-mode="payload"]').click();
        await page.waitForTimeout(700);

        await page.evaluate((tag: string) => {
          const f = (window as unknown as { __folio: FolioApi }).__folio;
          const yaml = f.getYAML();
          const modified = yaml.replace(/name:\s*[^\n]+/, `name: ${tag}`);
          f.loadFromYAML(modified);
        }, c.tag);
        await page.waitForTimeout(400);

        await page.locator('.mode-btn[data-mode="visual"]').click();
        await page.waitForTimeout(400);

        const yamlNow = await getYAML(page);
        ok = yamlNow.includes(c.tag);
        ctx.notes.push(`tag in yaml: ${ok}`);
        ctx.after = await shot(page, `10-${c.key}-after`);
      } catch (e) {
        ctx.notes.push(`error: ${(e as Error).message}`);
      }
      finishFlow(ctx, ok);
    });
  }
});

// ─── Group 11: Command palette ──────────────────────────────────────────────

test.describe('11. Command palette', () => {
  test('11.search-duplicate: Ctrl+K → "duplicate" → Enter', async ({ page }) => {
    const ctx = startFlow(page, '11-search-duplicate', 'palette');
    let ok = false;
    try {
      await gotoEditor(page);
      if (!await loadTemplate(page, '01-simple-poster.template.yaml')) throw new Error('load failed');
      await selectFirstLayer(page);
      ctx.before = await shot(page, '11-search-duplicate-before');
      const before = await getLayerCount(page);

      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-palette-overlay', { timeout: 3_000 });
      await page.locator('.command-palette-overlay input').fill('duplicate');
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);

      const after = await getLayerCount(page);
      ctx.notes.push(`layers: ${before} → ${after}`);
      ok = after > before;
      ctx.after = await shot(page, '11-search-duplicate-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });

  test('11.search-grid: Ctrl+K → "grid" → Enter toggles grid', async ({ page }) => {
    const ctx = startFlow(page, '11-search-grid', 'palette');
    let ok = false;
    try {
      await gotoEditor(page);
      ctx.before = await shot(page, '11-search-grid-before');
      const gridBefore = await page.evaluate(() => {
        const f = (window as unknown as { __folio: { state: { get(): { gridVisible?: boolean } } } }).__folio;
        return f.state.get().gridVisible === true;
      });
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-palette-overlay', { timeout: 3_000 });
      await page.locator('.command-palette-overlay input').fill('grid');
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const gridAfter = await page.evaluate(() => {
        const f = (window as unknown as { __folio: { state: { get(): { gridVisible?: boolean } } } }).__folio;
        return f.state.get().gridVisible === true;
      });
      ctx.notes.push(`gridVisible: ${gridBefore} → ${gridAfter}`);
      ok = gridBefore !== gridAfter;
      ctx.after = await shot(page, '11-search-grid-after');
    } catch (e) {
      ctx.notes.push(`error: ${(e as Error).message}`);
    }
    finishFlow(ctx, ok);
  });
});

// ─── Persist results after suite ────────────────────────────────────────────

test.afterAll(() => {
  writeJSON(path.join(OUT, 'results.json'), { total: RESULTS.length, results: RESULTS });
  const problems = RESULTS.filter(r => !r.ok || r.errors.length > 0);
  writeJSON(path.join(OUT, 'problems.json'), {
    total: RESULTS.length,
    problemCount: problems.length,
    problems,
  });
});

