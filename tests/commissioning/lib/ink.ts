/**
 * Ink measurement — "did anything actually paint here?"
 *
 * A missing asset does not crash and does not change the file size much; it
 * leaves a perfectly FLAT rectangle where the artwork should be. So the signal
 * we assert on is variety: a region holding real artwork has many colours, a
 * region the engine dropped has exactly one.
 *
 * Decoding happens inside the browser page (canvas), which keeps this
 * dependency-free — the repo ships no PNG decoder and does not need one.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import type { Region, InkStat } from './harness';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

/** Read a rendered artifact off disk as a data: URI the page can decode. */
export function fileToDataUri(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

interface MeasureArgs { src: string; regions: Region[] }

/**
 * Per-region ink for one artifact. Regions are page fractions, so the same
 * region list works against a ×1 PNG, a ×3 PNG or a rasterized PDF page.
 */
export async function measureInk(page: Page, src: string, regions: Region[]): Promise<InkStat[]> {
  return page.evaluate(async ({ src, regions }: MeasureArgs): Promise<InkStat[]> => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = (): void => resolve(i);
      i.onerror = (): void => reject(new Error('artifact failed to decode'));
      i.src = src;
    });
    const W = img.naturalWidth, H = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);

    // The page background: the single most common colour across the whole
    // artifact. Everything else counts as ink.
    const quantise = (d: Uint8ClampedArray, i: number): number => {
      const a = d[i + 3] ?? 0;
      return a < 8 ? -1 : (((d[i] ?? 0) >> 4) << 8) | (((d[i + 1] ?? 0) >> 4) << 4) | ((d[i + 2] ?? 0) >> 4);
    };
    const whole = ctx.getImageData(0, 0, W, H).data;
    const pageCounts = new Map<number, number>();
    // Sample every 4th pixel — enough to find the modal colour, 16× cheaper.
    for (let i = 0; i < whole.length; i += 16) {
      const k = quantise(whole, i);
      pageCounts.set(k, (pageCounts.get(k) ?? 0) + 1);
    }
    let pageColour = -1, pageBest = -1;
    for (const [k, n] of pageCounts) if (n > pageBest) { pageBest = n; pageColour = k; }

    return regions.map(r => {
      // Inset by 1px: a hairline border on a card would otherwise read as ink
      // even when the artwork inside it is missing.
      const x = Math.max(0, Math.round(r.x * W) + 1);
      const y = Math.max(0, Math.round(r.y * H) + 1);
      const w = Math.max(1, Math.round(r.w * W) - 2);
      const h = Math.max(1, Math.round(r.h * H) - 2);
      const data = ctx.getImageData(x, y, Math.min(w, W - x), Math.min(h, H - y)).data;

      const counts = new Map<number, number>();
      let differing = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        // Quantise to 4 bits/channel: anti-aliasing must not read as variety.
        const key = a < 8 ? -1 : (((data[i] ?? 0) >> 4) << 8) | (((data[i + 1] ?? 0) >> 4) << 4) | ((data[i + 2] ?? 0) >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
        if (key !== pageColour) differing++;
      }
      // Ink = "differs from the PAGE background", not "varies internally". A
      // solid-colour logo is perfectly uniform, and a variety-only metric calls
      // it missing — the exact false alarm this comparison removes.
      return {
        id: r.id, kind: r.kind, colours: counts.size,
        inkRatio: total > 0 ? differing / total : 0,
      };
    });
  }, { src, regions } as MeasureArgs) as Promise<InkStat[]>;
}

/** Whole-artifact ink — catches the blank-page class of failure outright. */
export async function pageInk(page: Page, src: string): Promise<{ inkRatio: number; colours: number }> {
  const [stat] = await measureInk(page, src, [{ id: 'page', kind: 'image', x: 0, y: 0, w: 1, h: 1 }]);
  return { inkRatio: stat?.inkRatio ?? 0, colours: stat?.colours ?? 0 };
}
