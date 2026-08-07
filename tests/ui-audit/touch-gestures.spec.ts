import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Phone touch guard. The canvas was mouse-only — zoom on ctrl+wheel, pan on
// wheel, context menu on `contextmenu` — so on a phone there was no way to move
// the view at all and no way to reach the context menu. These check the four
// gestures end to end, through the real handlers.
//
// Gestures are dispatched as in-page TouchEvents rather than through Playwright:
// Chromium's mobile emulation reports maxTouchPoints = 1, so a genuine
// two-finger sequence never reaches the page and pinch looks broken when it is
// not. The events below are real DOM TouchEvents hitting the real listeners.

const DESIGN = `
meta: { name: Touch Guard, type: poster }
document: { width: 1080, height: 1350, unit: px, dpi: 96 }
layers:
  - { id: bg, type: rect, x: 0, y: 0, width: 1080, height: 1350, fill: "#0f2233" }
  - { id: title, type: text, x: 80, y: 140, width: 900, content: "Automation you can build today", style: { font_size: 92, color: "#ffffff", font_weight: 800 } }
  - { id: card, type: rect, x: 80, y: 700, width: 500, height: 320, fill: "#1b6b4a" }
`;

async function openPhoneEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__folio?.state?.get().design);
  await page.evaluate(y => (window as any).__folio.loadFromYAML(y), DESIGN);
  await page.waitForTimeout(600);
}

// A real touchscreen, not just a narrow window: the gesture module is loaded
// only where `(pointer: coarse)` matches, which is exactly where it is needed.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.describe('canvas touch gestures on a phone', () => {
  test('the gestures are wired to the pane the canvas renders into', async ({ page }) => {
    await openPhoneEditor(page);
    // Wiring the wrong element fails silently — every gesture simply does
    // nothing — so this is asserted before anything that depends on it.
    const wired = await page.evaluate(() => {
      const el = document.querySelector('[data-folio-gestures]');
      return el ? { cls: el.className, holdsCanvas: !!el.querySelector('svg') } : null;
    });
    expect(wired).not.toBeNull();
    expect(wired?.holdsCanvas).toBe(true);
  });

  test('pinch zooms the canvas and stays anchored between the fingers', async ({ page }) => {
    await openPhoneEditor(page);
    const r = await page.evaluate(() => {
      const pane = document.querySelector('[data-folio-gestures]') as HTMLElement;
      const st = () => (window as any).__folio.state.get();
      const before = { zoom: st().zoom, panX: st().panX };
      // Pan is measured from the pane's own origin, past the ruler gutter —
      // the same space touch-gestures.ts works in.
      const originX = pane.getBoundingClientRect().left
        + (document.querySelector('.ruler-v') as HTMLElement)?.getBoundingClientRect().width;
      const T = (x: number, y: number, id: number) => new Touch({ identifier: id, target: pane, clientX: x, clientY: y });
      const ev = (t: string, touches: Touch[]) => pane.dispatchEvent(new TouchEvent(t, { touches, changedTouches: touches, bubbles: true, cancelable: true }));
      ev('touchstart', [T(150, 400, 1), T(250, 400, 2)]);
      ev('touchmove', [T(100, 400, 1), T(300, 400, 2)]);   // 100px apart → 200px
      const after = { zoom: st().zoom, panX: st().panX };
      ev('touchend', []);
      // The design x under the pinch midpoint (200px) must not move.
      const designAt = (s: { zoom: number; panX: number }) => (200 - originX - s.panX) / s.zoom;
      return { before, after, drift: Math.abs(designAt(after) - designAt(before)) };
    });
    expect(r.after.zoom).toBeGreaterThan(r.before.zoom * 1.5);
    expect(r.drift).toBeLessThan(2);
  });

  test('a one-finger drag on empty canvas pans, and on a layer still moves it', async ({ page }) => {
    await openPhoneEditor(page);
    const panned = await page.evaluate(() => {
      const pane = document.querySelector('[data-folio-gestures]') as HTMLElement;
      const st = () => (window as any).__folio.state.get();
      const art = document.querySelector('svg [data-layer-id="bg"]')!.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      // a point inside the pane but outside the artboard
      const x = art.left > box.left + 24 ? (box.left + art.left) / 2 : (art.right + box.right) / 2;
      const y = art.top + art.height / 2;
      const before = { panX: st().panX, panY: st().panY };
      const T = (dx: number, dy: number) => new Touch({ identifier: 1, target: pane, clientX: x + dx, clientY: y + dy });
      const ev = (t: string, touches: Touch[]) => pane.dispatchEvent(new TouchEvent(t, { touches, changedTouches: touches.length ? touches : [T(0, 0)], bubbles: true, cancelable: true }));
      ev('touchstart', [T(0, 0)]);
      ev('touchmove', [T(40, 60)]);
      ev('touchend', []);
      return { before, after: { panX: st().panX, panY: st().panY } };
    });
    expect(panned.after.panX).toBe(panned.before.panX + 40);
    expect(panned.after.panY).toBe(panned.before.panY + 60);

    // On a LAYER the gesture must stay out of the way: the pointer path that
    // moves layers has to keep working, so panning must NOT also happen.
    const onLayer = await page.evaluate(() => {
      const pane = document.querySelector('[data-folio-gestures]') as HTMLElement;
      const st = () => (window as any).__folio.state.get();
      const el = document.querySelector('svg [data-layer-id="card"]')!;
      const r = el.getBoundingClientRect();
      const before = { panX: st().panX, panY: st().panY };
      const T = (dx: number) => new Touch({ identifier: 1, target: el as unknown as Element, clientX: r.x + r.width / 2 + dx, clientY: r.y + r.height / 2 });
      const ev = (t: string, touches: Touch[]) => el.dispatchEvent(new TouchEvent(t, { touches, changedTouches: touches.length ? touches : [T(0)], bubbles: true, cancelable: true }));
      ev('touchstart', [T(0)]);
      ev('touchmove', [T(50)]);
      ev('touchend', []);
      return { before, after: { panX: st().panX, panY: st().panY } };
    });
    expect(onLayer.after).toEqual(onLayer.before);
  });

  test('long press opens the context menu inside the screen', async ({ page }) => {
    await openPhoneEditor(page);
    await page.evaluate(() => {
      const pane = document.querySelector('[data-folio-gestures]') as HTMLElement;
      const el = document.querySelector('svg [data-layer-id="card"]')!;
      const r = el.getBoundingClientRect();
      const T = () => new Touch({ identifier: 1, target: el as unknown as Element, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
      pane.dispatchEvent(new TouchEvent('touchstart', { touches: [T()], changedTouches: [T()], bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(700);
    const menu = await page.evaluate(() => {
      const m = document.querySelector('.canvas-context-menu');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { visible: r.width > 0 && r.height > 0, inside: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    expect(menu?.visible).toBe(true);
    expect(menu?.inside).toBe(true);
  });

  test('double tap on a text layer opens the inline editor', async ({ page }) => {
    await openPhoneEditor(page);
    const editing = await page.evaluate(async () => {
      const pane = document.querySelector('[data-folio-gestures]') as HTMLElement;
      const el = document.querySelector('svg [data-layer-id="title"]')!;
      const r = el.getBoundingClientRect();
      // Aim at the glyphs, not the centre of the box — the middle of a text
      // layer is often empty and hit-tests to whatever sits behind it.
      const T = () => new Touch({ identifier: 1, target: el as unknown as Element, clientX: r.x + 12, clientY: r.y + r.height / 2 });
      const ev = (t: string, touches: Touch[]) => pane.dispatchEvent(new TouchEvent(t, { touches, changedTouches: touches.length ? touches : [T()], bubbles: true, cancelable: true }));
      ev('touchstart', [T()]); ev('touchend', []);
      await new Promise(res => setTimeout(res, 90));
      ev('touchstart', [T()]); ev('touchend', []);
      await new Promise(res => setTimeout(res, 320));
      return !!document.querySelector('.inline-text-editor, [contenteditable="true"], .text-edit-overlay');
    });
    expect(editing).toBe(true);
  });

  test('every visible control clears a 40px touch target', async ({ page }) => {
    await openPhoneEditor(page);
    const small = await page.evaluate(() => {
      const out: { cls: string; label: string; w: number; h: number }[] = [];
      for (const el of document.querySelectorAll('button, select, input, [role="button"], .layer-row, .mob-pop-item')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (r.width < 40 || r.height < 40) {
          out.push({ cls: String(el.className).slice(0, 40), label: (el.getAttribute('title') ?? el.textContent ?? '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return out;
    });
    expect(small, `undersized touch targets: ${JSON.stringify(small)}`).toEqual([]);
  });
});
