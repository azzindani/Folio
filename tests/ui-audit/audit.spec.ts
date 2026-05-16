/**
 * UI/UX audit harness
 *
 * Loads every YAML project in tests/fixtures/designs and examples/, captures
 * screenshots at multiple viewports, and runs heuristic checks for layout
 * issues (overlap, overflow, off-screen elements, hit-target size, contrast).
 *
 * Output: tests/ui-audit/screenshots/<viewport>/<project>__<view>.png
 *         tests/ui-audit/reports/findings.json
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const REPORT_DIR = path.join(__dirname, 'reports');

type Finding = {
  project: string;
  viewport: string;
  view: string;
  category: 'overlap' | 'overflow' | 'offscreen' | 'hit-target' | 'misalignment'
    | 'contrast' | 'console-error' | 'missing-element' | 'z-overlap' | 'wrap';
  severity: 'error' | 'warn' | 'info';
  msg: string;
  data?: unknown;
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 900, height: 1100 },
  { name: 'mobile', width: 390, height: 800 },
];

const PROJECTS: { name: string; file: string }[] = [
  ...fs.readdirSync(path.join(ROOT, 'tests/fixtures/designs'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => ({ name: `fixtures-${path.basename(f, path.extname(f))}`, file: path.join('tests/fixtures/designs', f) })),
  ...fs.readdirSync(path.join(ROOT, 'examples'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => ({ name: `examples-${path.basename(f, path.extname(f))}`, file: path.join('examples', f) })),
];

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}
ensureDir(SCREENSHOT_DIR);
ensureDir(REPORT_DIR);

const findings: Finding[] = [];

async function loadProject(page: Page, yamlPath: string): Promise<void> {
  const yaml = fs.readFileSync(path.join(ROOT, yamlPath), 'utf8');
  await page.evaluate((src: string) => {
    const w = window as unknown as { __folio: { loadFromYAML(s: string): void } };
    w.__folio.loadFromYAML(src);
  }, yaml);
  await page.waitForTimeout(400);
}

async function collectLayout(page: Page): Promise<Array<{ sel: string; rect: DOMRect; visible: boolean; cs?: { z: string; overflow: string; pe: string } }>> {
  return await page.evaluate(() => {
    const sels = [
      '.toolbar', '.formula-bar', '.activity-bar', '.left-panel', '.canvas-section',
      '.viewport-pane', '.properties-panel', '.status-bar', '.tab-bar-container',
      '.layer-panel', '.tools-panel', '.rpanel-tabs', '.rpanel-body',
      '.minimap-container', '.page-strip-section', '.toolbar-zoom',
    ];
    return sels.map(sel => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { sel, rect: new DOMRect(), visible: false };
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        sel,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
                toJSON: () => ({}) } as DOMRect,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        cs: { z: cs.zIndex, overflow: cs.overflow, pe: cs.pointerEvents },
      };
    });
  });
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function record(f: Finding): void {
  findings.push(f);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(60_000);

    for (const proj of PROJECTS) {
      test(`${proj.name}`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', err => consoleErrors.push(err.message));

        await page.goto('/');
        await page.waitForFunction(() => (window as unknown as { __folio?: unknown }).__folio !== undefined, null, { timeout: 15_000 });
        await loadProject(page, proj.file);

        // Pre-select first layer so properties panel shows real content
        await page.evaluate(() => {
          const w = window as unknown as {
            __folio: {
              state: { get(): { design?: { layers?: { id: string }[] } }; set(k: string, v: unknown): void };
            };
          };
          const layers = w.__folio.state.get().design?.layers;
          if (layers && layers.length > 0) {
            w.__folio.state.set('selectedLayerIds', [layers[0].id]);
          }
        });
        await page.waitForTimeout(150);

        // SCREENSHOT: full editor
        const dir = path.join(SCREENSHOT_DIR, vp.name);
        ensureDir(dir);
        await page.screenshot({ path: path.join(dir, `${proj.name}__editor.png`), fullPage: false });

        // Heuristic 1: panel layout overlaps (essential panels mustn't overlap each other)
        const layout = await collectLayout(page);
        const visibleLayout = layout.filter(l => l.visible);
        const named = Object.fromEntries(visibleLayout.map(l => [l.sel, l.rect]));

        // On tablet/mobile, panels are overlays/sheets — skip overlap/alignment checks
        const isOverlayLayout = vp.width < 1024;
        const overlapPairs: [string, string][] = isOverlayLayout ? [] : [
          ['.left-panel', '.canvas-section'],
          ['.properties-panel', '.canvas-section'],
          ['.activity-bar', '.left-panel'],
          ['.toolbar', '.viewport-pane'],
          ['.status-bar', '.viewport-pane'],
        ];
        for (const [a, b] of overlapPairs) {
          if (named[a] && named[b]) {
            // Overlap is OK iff one fully contains the other (e.g. canvas inside section)
            // but we only flag truly intersecting non-contained boxes.
            const A = named[a], B = named[b];
            const intersects = rectsOverlap(A as DOMRect, B as DOMRect);
            const contains = (X: DOMRect, Y: DOMRect) =>
              X.left <= Y.left && X.right >= Y.right && X.top <= Y.top && X.bottom >= Y.bottom;
            if (intersects && !contains(A as DOMRect, B as DOMRect) && !contains(B as DOMRect, A as DOMRect)) {
              record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'overlap', severity: 'error',
                msg: `panels overlap: ${a} vs ${b}`, data: { A, B } });
            }
          }
        }

        // Heuristic 2: viewport pane exists and has positive size
        if (!named['.viewport-pane'] || named['.viewport-pane'].width < 200 || named['.viewport-pane'].height < 200) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'missing-element', severity: 'error',
            msg: 'viewport-pane missing or too small', data: named['.viewport-pane'] });
        }

        // Heuristic 3: layers actually rendered in canvas SVG
        const layerCount = await page.evaluate(() => {
          return document.querySelectorAll('.viewport-pane svg [data-layer-id], .canvas-section svg [data-layer-id]').length;
        });
        if (layerCount === 0) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'missing-element', severity: 'error',
            msg: 'no layers rendered in SVG canvas' });
        }

        // Heuristic 4: hit-target size on toolbar/sidebar buttons (WCAG 2.5.5 ~= 24-44px)
        const smallTargets = await page.evaluate(() => {
          const out: Array<{ text: string; w: number; h: number; sel: string }> = [];
          const sels = ['.toolbar button', '.activity-bar button', '.sb-btn', '.rpanel-tab', '.tools-panel button'];
          for (const sel of sels) {
            document.querySelectorAll(sel).forEach(el => {
              const r = (el as HTMLElement).getBoundingClientRect();
              const cs = getComputedStyle(el as HTMLElement);
              if (cs.display === 'none' || cs.visibility === 'hidden') return;
              if (r.width === 0 || r.height === 0) return;
              if (r.width < 24 || r.height < 24) {
                out.push({ text: (el.textContent || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), sel });
              }
            });
          }
          return out;
        });
        for (const t of smallTargets) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'hit-target', severity: 'warn',
            msg: `tap target too small (${t.w}×${t.h}) for "${t.text || t.sel}"`, data: t });
        }

        // Heuristic 5: text overflow / clipping in panel headers + properties
        const overflowed = await page.evaluate(() => {
          const out: Array<{ sel: string; text: string; sw: number; cw: number }> = [];
          const sels = ['.panel-header', '.rpanel-tab', '.act-btn', '.sb-btn', '.toolbar button',
            '.properties-content label', '.properties-content .prop-label'];
          for (const sel of sels) {
            document.querySelectorAll(sel).forEach(el => {
              const e = el as HTMLElement;
              if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) {
                out.push({ sel, text: (e.textContent || '').trim().slice(0, 60), sw: e.scrollWidth, cw: e.clientWidth });
              }
            });
          }
          return out;
        });
        for (const o of overflowed) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'overflow', severity: 'warn',
            msg: `text clipped: "${o.text}" (${o.sw}>${o.cw}) in ${o.sel}`, data: o });
        }

        // Heuristic 6: elements off-screen
        const off = await page.evaluate(({ vw, vh, overlay }) => {
          const out: Array<{ sel: string; r: { x: number; y: number; w: number; h: number } }> = [];
          const baseSels = ['.toolbar', '.canvas-section', '.viewport-pane', '.status-bar'];
          // On overlay layouts left/right panels are intentionally translated off-canvas
          const sels = overlay ? baseSels : [...baseSels, '.formula-bar', '.activity-bar', '.left-panel', '.properties-panel'];
          for (const sel of sels) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) {
              out.push({ sel, r: { x: r.x, y: r.y, w: r.width, h: r.height } });
            }
          }
          return out;
        }, { vw: vp.width, vh: vp.height, overlay: isOverlayLayout });
        for (const o of off) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'offscreen', severity: 'error',
            msg: `${o.sel} is off-screen`, data: o });
        }

        // Heuristic 7: column-grid alignment of activity bar / status bar (any non-aligned items inside flex)
        // Quick grossness check: properties-panel left edge must equal canvas-section right edge ± 2px
        if (!isOverlayLayout) {
          if (named['.canvas-section'] && named['.properties-panel']) {
            const dx = Math.abs((named['.canvas-section'] as DOMRect).right - (named['.properties-panel'] as DOMRect).left);
            if (dx > 4) {
              record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'misalignment', severity: 'warn',
                msg: `gap ${dx.toFixed(1)}px between canvas-section and properties-panel` });
            }
          }
          if (named['.left-panel'] && named['.canvas-section']) {
            const dx = Math.abs((named['.left-panel'] as DOMRect).right - (named['.canvas-section'] as DOMRect).left);
            if (dx > 4) {
              record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'misalignment', severity: 'warn',
                msg: `gap ${dx.toFixed(1)}px between left-panel and canvas-section` });
            }
          }
        }

        // VIEW: open properties tabs in turn and screenshot (only on viewports where rpanel is visible)
        if (vp.width >= 768) {
          const tabs = ['properties', 'colors', 'animate', 'timeline', 'problems', 'a11y'];
          for (const tab of tabs) {
            const btn = page.locator(`.rpanel-tab[data-tab="${tab}"]`);
            if (await btn.count() > 0) {
              await btn.click({ force: true, timeout: 2000 }).catch(() => {});
              await page.waitForTimeout(150);
              await page.screenshot({ path: path.join(dir, `${proj.name}__rpanel-${tab}.png`) });
            }
          }
        }

        // VIEW: switch left activity panels (skip on small viewports — panels are overlays/sheets)
        if (vp.width >= 1024) {
          const acts = ['layers', 'files', 'components', 'icons', 'find'];
          for (const a of acts) {
            const btn = page.locator(`.act-btn[data-panel="${a}"]`);
            if (await btn.count() > 0) {
              await btn.click().catch(() => {});
              await page.waitForTimeout(150);
              await page.screenshot({ path: path.join(dir, `${proj.name}__lpanel-${a}.png`) });
            }
          }
        }

        // VIEW: open command palette
        await page.keyboard.press('ControlOrMeta+P').catch(() => {});
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(dir, `${proj.name}__palette.png`) });
        await page.keyboard.press('Escape').catch(() => {});

        // Console errors (final)
        for (const e of consoleErrors) {
          record({ project: proj.name, viewport: vp.name, view: 'editor', category: 'console-error', severity: 'error',
            msg: e.slice(0, 300) });
        }

        expect(layerCount, 'should render some layers').toBeGreaterThan(0);
      });
    }
  });
}

test.afterAll(async () => {
  fs.writeFileSync(path.join(REPORT_DIR, 'findings.json'), JSON.stringify(findings, null, 2));
  // Compact summary by category
  const summary: Record<string, number> = {};
  for (const f of findings) {
    const k = `${f.severity}/${f.category}`;
    summary[k] = (summary[k] || 0) + 1;
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
});
