/**
 * Catalog card UI/UX audit. Opens the Catalog, walks every tab, captures
 * full screenshots, and measures card + thumbnail geometry so we can reason
 * about card height (the tall-card complaint) with hard numbers, not vibes.
 *
 * Resilient open: the activity-bar path can vary between builds, so we try
 * several strategies and always dump a button inventory + an initial
 * screenshot for debugging even if the open fails.
 *
 * Run: npx playwright test --config=playwright.audit.config.ts catalog-cards-audit
 * Output: tests/ui-audit/catalog-cards/*.png + report.json
 */
import { test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, 'catalog-cards');
fs.mkdirSync(OUT, { recursive: true });

test.setTimeout(120_000);

interface CardMetric {
  index: number;
  name: string;
  cardH: number;
  cardW: number;
  thumbH: number;
  thumbW: number;
  metaH: number;
}
const report: Record<string, unknown> = {};

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function dumpButtons(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).map((b, i) => ({
      i,
      text: (b.textContent ?? '').trim().slice(0, 30),
      title: b.getAttribute('title') ?? '',
      action: b.getAttribute('data-action') ?? '',
      cls: b.className.slice(0, 60),
    })).filter(b => b.text || b.title || b.action);
    const activity = Array.from(document.querySelectorAll('.activity-bar button, .activity-btn, .activity-bar *'))
      .map((e, i) => ({ i, tag: e.tagName, title: e.getAttribute('title') ?? '', cls: (e as HTMLElement).className.slice(0, 50) }));
    return { buttons: btns, activity };
  });
}

async function openCatalog(page: Page): Promise<boolean> {
  // Strategy 1: walk activity-bar buttons; after each, look for a Catalog button.
  const activityBtns = page.locator('.activity-bar button, .activity-bar .activity-btn');
  const n = await activityBtns.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    await activityBtns.nth(i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(200);
    const catBtn = page.locator('button').filter({ hasText: /^Catalog$/ }).first();
    if (await catBtn.count() > 0 && await catBtn.isVisible().catch(() => false)) {
      await catBtn.click().catch(() => {});
      if (await page.waitForSelector('.catalog', { timeout: 3000 }).then(() => true).catch(() => false)) return true;
    }
  }
  // Strategy 2: any element whose text is exactly Catalog.
  const anyCat = page.getByText(/^Catalog$/).first();
  if (await anyCat.count() > 0) {
    await anyCat.click().catch(() => {});
    if (await page.waitForSelector('.catalog', { timeout: 3000 }).then(() => true).catch(() => false)) return true;
  }
  // Strategy 3: data-action hook if one exists.
  const actionBtn = page.locator('[data-action="catalog"], [data-action="open-catalog"]').first();
  if (await actionBtn.count() > 0) {
    await actionBtn.click().catch(() => {});
    if (await page.waitForSelector('.catalog', { timeout: 3000 }).then(() => true).catch(() => false)) return true;
  }
  return false;
}

async function measureCards(page: Page, key: string, cardSel: string): Promise<void> {
  await page.waitForTimeout(900); // let thumbnails hydrate (IntersectionObserver)
  const metrics: CardMetric[] = await page.evaluate((sel) => {
    const out: CardMetric[] = [];
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel)).slice(0, 12);
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const thumb = c.querySelector<HTMLElement>('.tmpl-thumb, .theme-preview, .combo-thumb');
      const meta = c.querySelector<HTMLElement>('.tmpl-meta');
      const tr = thumb?.getBoundingClientRect();
      const mr = meta?.getBoundingClientRect();
      const nameEl = c.querySelector<HTMLElement>('.tmpl-name, .combo-thumb-title');
      out.push({
        index: i,
        name: nameEl?.textContent?.trim() ?? '?',
        cardH: Math.round(r.height),
        cardW: Math.round(r.width),
        thumbH: tr ? Math.round(tr.height) : -1,
        thumbW: tr ? Math.round(tr.width) : -1,
        metaH: mr ? Math.round(mr.height) : -1,
      });
    });
    return out;
  }, cardSel);
  const heights = metrics.map(m => m.cardH).filter(h => h > 0);
  report[key] = {
    count: metrics.length,
    cardHeight: heights.length ? { min: Math.min(...heights), max: Math.max(...heights), values: heights } : null,
    cards: metrics,
  };
}

test('Catalog cards — full audit across tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('.toolbar', { timeout: 20_000 });
  await page.waitForTimeout(600);

  // Always capture the editor + button inventory first, so a failed open
  // still leaves us something to diagnose with.
  await shot(page, '00-editor-initial');
  report['buttonInventory'] = await dumpButtons(page);

  const opened = await openCatalog(page);
  report['catalogOpened'] = opened;
  if (!opened) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    throw new Error('Could not open Catalog — see 00-editor-initial.png + report.json buttonInventory');
  }
  await page.waitForTimeout(700);

  // Templates tab (default) — the tall-card complaint lives here.
  await shot(page, '01-templates');
  await measureCards(page, 'templates', '.tmpl-card[data-template]');

  const listGeom = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.catalog-list');
    const grid = document.querySelector<HTMLElement>('.tmpl-grid');
    return {
      listClientH: list?.clientHeight ?? -1,
      listScrollH: list?.scrollHeight ?? -1,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : '',
      gridAutoRows: grid ? getComputedStyle(grid).gridAutoRows : '',
    };
  });
  report['listGeom'] = listGeom;

  // Filter bar height — the wrapping chip row used to push this to ~3 rows
  // (~84px). After the single-row-scroll fix it should be ~1 row.
  report['filterBar'] = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.catalog-filter');
    const chips = document.querySelector<HTMLElement>('.catalog-chips');
    return {
      barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : -1,
      chipsWrap: chips ? getComputedStyle(chips).flexWrap : '',
      chipsOverflowX: chips ? getComputedStyle(chips).overflowX : '',
    };
  });

  const tabs: Array<{ tab: string; sel: string; file: string }> = [
    { tab: 'themes',   sel: '.tmpl-card[data-theme-id]',    file: '02-themes' },
    { tab: 'palettes', sel: '.tmpl-card[data-palette-id]',  file: '03-palettes' },
    { tab: 'type',     sel: '.tmpl-card[data-typepack-id]', file: '04-type' },
    { tab: 'effects',  sel: '.tmpl-card[data-effects-id]',  file: '05-effects' },
    { tab: 'reports',  sel: '.tmpl-card[data-template]',    file: '06-reports' },
    { tab: 'featured', sel: '.tmpl-card[data-combo-id]',    file: '07-featured' },
  ];
  for (const t of tabs) {
    await page.locator(`.catalog-tab[data-tab="${t.tab}"]`).click().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, t.file);
    await measureCards(page, t.tab, t.sel);
    if (t.tab === 'reports') {
      // Verify the "Report" type badge renders on every report card.
      report['reportBadges'] = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.tmpl-card[data-template]'));
        const withBadge = cards.filter(c => c.querySelector('.tmpl-thumb-badge')).length;
        return { totalCards: cards.length, withBadge };
      });
    }
  }

  // Back to templates, pick the first card so the rail preview renders.
  await page.locator('.catalog-tab[data-tab="templates"]').click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('.tmpl-card[data-template]').first().click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, '08-templates-with-rail');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
});
