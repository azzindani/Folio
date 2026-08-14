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
      // Track the dominant NON-background colour at full precision, so a check
      // can say "the orange copy won", not merely "something painted".
      const inkCounts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        // Quantise to 4 bits/channel: anti-aliasing must not read as variety.
        const key = a < 8 ? -1 : (((data[i] ?? 0) >> 4) << 8) | (((data[i + 1] ?? 0) >> 4) << 4) | ((data[i + 2] ?? 0) >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
        if (key !== pageColour) {
          differing++;
          const hex = `#${[data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
            .map(v => (v >> 4 << 4).toString(16).padStart(2, '0')).join('')}`;
          inkCounts.set(hex, (inkCounts.get(hex) ?? 0) + 1);
        }
      }
      let dominant = '', domBest = 0;
      for (const [hex, n] of inkCounts) if (n > domBest) { domBest = n; dominant = hex; }
      // Ink = "differs from the PAGE background", not "varies internally". A
      // solid-colour logo is perfectly uniform, and a variety-only metric calls
      // it missing — the exact false alarm this comparison removes.
      return {
        id: r.id, kind: r.kind, colours: counts.size, dominant,
        inkRatio: total > 0 ? differing / total : 0,
      };
    });
  }, { src, regions } as MeasureArgs) as Promise<InkStat[]>;
}

/**
 * A perceptual fingerprint per region (256-bit average hash): the region is
 * downsampled to 16×16 greyscale and each cell scored against the mean.
 *
 * 16×16 is not arbitrary. At 8×8 a line of text is too coarse to separate —
 * measured across four faces, pairs differed by only 5–11 bits of 64, while the
 * same pairs differ by 20–41 bits of 256 at 16×16. The finer grid is what makes
 * the threshold meaningful rather than a coin toss.
 *
 * This is what makes font fidelity testable WITHOUT a network or any knowledge
 * of glyph shapes. Rather than asking "is this Anton?", render the same string
 * in two families and require the results to LOOK different — if the engine
 * ignored the family, or silently fell back to the same default face, the two
 * fingerprints come out identical.
 */
export async function fingerprints(page: Page, src: string, regions: Region[]): Promise<Array<{ id: string; hash: string }>> {
  return page.evaluate(async ({ src, regions }: MeasureArgs) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = (): void => resolve(i);
      i.onerror = (): void => reject(new Error('artifact failed to decode'));
      i.src = src;
    });
    const W = img.naturalWidth, H = img.naturalHeight;
    const full = document.createElement('canvas');
    full.width = W; full.height = H;
    const fctx = full.getContext('2d');
    if (!fctx) throw new Error('no 2d context');
    fctx.drawImage(img, 0, 0);

    return regions.map(r => {
      const sx = Math.max(0, Math.round(r.x * W));
      const sy = Math.max(0, Math.round(r.y * H));
      const sw = Math.max(1, Math.min(Math.round(r.w * W), W - sx));
      const sh = Math.max(1, Math.min(Math.round(r.h * H), H - sy));
      const N = 16;
      const small = document.createElement('canvas');
      small.width = N; small.height = N;
      const sctx = small.getContext('2d');
      if (!sctx) throw new Error('no 2d context');
      sctx.drawImage(full, sx, sy, sw, sh, 0, 0, N, N);
      const px = sctx.getImageData(0, 0, N, N).data;
      const grey: number[] = [];
      for (let i = 0; i < px.length; i += 4) {
        grey.push(0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0));
      }
      const mean = grey.reduce((a, b) => a + b, 0) / (grey.length || 1);
      return { id: r.id, hash: grey.map(g => (g >= mean ? '1' : '0')).join('') };
    });
  }, { src, regions } as MeasureArgs) as Promise<Array<{ id: string; hash: string }>>;
}

/** How many bits two fingerprints differ by — 0 means visually identical. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Whole-artifact ink — catches the blank-page class of failure outright. */
export async function pageInk(page: Page, src: string): Promise<{ inkRatio: number; colours: number }> {
  const [stat] = await measureInk(page, src, [{ id: 'page', kind: 'image', x: 0, y: 0, w: 1, h: 1 }]);
  return { inkRatio: stat?.inkRatio ?? 0, colours: stat?.colours ?? 0 };
}

/** Load a standalone artifact (an exported HTML file) and measure what it
 *  paints on its own — the real question for a "self-contained" export. */
export async function inkOfStandaloneFile(page: Page, file: string): Promise<{ inkRatio: number; colours: number }> {
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1500);
  const shot = await page.screenshot({ fullPage: false });
  return pageInk(page, `data:image/png;base64,${shot.toString('base64')}`);
}
