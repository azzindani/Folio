import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Desktop UX guards. Each of these covers a defect found by driving the editor
// at real desktop sizes, not by reading the CSS.

const DESIGN = `
meta: { name: Desktop UX, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#0f2233" }
  - { id: title, type: text, x: 80, y: 140, width: 900, content: "Automation you can build today", style: { font_size: 92, color: "#ffffff" } }
  - { id: card, type: rect, x: 80, y: 700, width: 500, height: 320, fill: "#1b6b4a" }
`;

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.evaluate(y => (window as any).__folio.loadFromYAML(y), DESIGN);
  await page.waitForTimeout(600);
}

test.describe('the canvas keeps a workable share of the window', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Before: a flat 200px floor meant 900px gave the canvas 242px and 15% zoom
  // while 560px of chrome showed four layer names and an empty properties pane.
  for (const [width, minPct] of [[1920, 50], [1440, 42], [1280, 36], [1150, 45], [960, 40]] as const) {
    test(`at ${width}px the canvas is at least ${minPct}% of the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openEditor(page);
      const pct = await page.evaluate(() => {
        const a = document.querySelector('.canvas-area');
        if (!a) return 0;
        const r = a.getBoundingClientRect();
        return Math.round((r.width * r.height) / (innerWidth * innerHeight) * 100);
      });
      expect(pct, `canvas share at ${width}px`).toBeGreaterThanOrEqual(minPct);
    });
  }

  test('no horizontal page scroll at any desktop width', async ({ page }) => {
    for (const width of [1920, 1440, 1280, 1150, 960, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await openEditor(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(over, `horizontal overflow at ${width}px`).toBe(false);
    }
  });
});

test.describe('minimap', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('draws the design at its real aspect ratio', async ({ page }) => {
    await openEditor(page);
    // It used to measure the panel before layout (clientWidth 0 → a 240px
    // fallback), then stretch the canvas element to 100% of the real ~300px:
    // a 1080×1350 portrait poster rendered very nearly square.
    const r = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.minimap-container canvas');
      if (!c) return null;
      const box = c.getBoundingClientRect();
      const d = (window as any).__folio.state.get().design.document;
      return { shown: box.width / box.height, design: d.width / d.height, h: box.height };
    });
    expect(r).not.toBeNull();
    expect(Math.abs((r?.shown ?? 0) - (r?.design ?? 1))).toBeLessThan(0.03);
  });

  test('does not claim more than a quarter of the window height', async ({ page }) => {
    await openEditor(page);
    const h = await page.evaluate(() => {
      const el = document.querySelector('.minimap-container');
      return el ? el.getBoundingClientRect().height : 0;
    });
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(900 * 0.25 + 2);
  });
});

test.describe('shortcut hints match the platform', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a non-Mac browser is never shown ⌘ or ⌥', async ({ page }) => {
    await openEditor(page);
    const found = await page.evaluate(() => {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
      const text = document.body.innerText;
      const titles = [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title') ?? '').join(' ');
      return { isMac, glyphs: (`${text} ${titles}`.match(/[⌘⌥]/g) ?? []).length, hasCtrl: /Ctrl/.test(text) };
    });
    if (found.isMac) test.skip();
    expect(found.glyphs, 'Mac-only glyphs shown on a non-Mac').toBe(0);
    expect(found.hasCtrl, 'Ctrl should appear in the tips instead').toBe(true);
  });
});

test.describe('layer list state is legible without hovering', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a hidden layer shows its state with the pointer away', async ({ page }) => {
    await openEditor(page);
    await page.mouse.move(700, 500);   // pointer off the layer list
    await page.evaluate(() => {
      const st = (window as any).__folio.state;
      const d = st.get().design;
      d.layers.find((l: any) => l.id === 'card').visible = false;
      st.set('design', { ...d });
    });
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => {
      const row = document.querySelector('.layer-row[data-layer-id="card"]');
      const btn = row?.querySelector<HTMLElement>('.layer-vis-btn');
      return btn ? Number(getComputedStyle(btn).opacity) : -1;
    });
    expect(shown, 'the hidden-layer indicator must not be hover-only').toBeGreaterThan(0.5);
  });
});
