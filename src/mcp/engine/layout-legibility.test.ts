import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { seenTexts, withoutText, textOnGround, legibilityNotes, type SeenText } from './layout-legibility';
import { reviewLayout } from './layout-review';

const text = (id: string, x: number, y: number, w: number, h: number, size: number, color: string, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: w, height: h, content: { type: 'plain', value: 'READ ME PLEASE' }, style: { font_size: size, color, font_weight: 700 }, ...extra }) as unknown as Layer;
const rect = (id: string, x: number, y: number, w: number, h: number, color: string): Layer =>
  ({ id, type: 'rect', z: 1, x, y, width: w, height: h, fill: { type: 'solid', color } }) as unknown as Layer;

/** A W×H RGBA buffer, left half one grey, right half another. */
function split(W: number, H: number, left: number, right: number): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = x < W / 2 ? left : right, i = (y * W + x) * 4;
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  return px;
}

describe('seenTexts + withoutText', () => {
  it('finds the texts a viewer reads — skipping faint ones, carrying a posed group — and hides them for the backdrop', () => {
    const moved = { id: 'g', type: 'group', z: 2, x: 0, y: 0, width: 100, height: 100, _frame_pose: { dx: 40, dy: 0, scale_x: 1, scale_y: 1 },
      layers: [text('inner', 0, 0, 200, 40, 32, '#FFFFFF')] } as unknown as Layer;
    const t = seenTexts([rect('bg', 0, 0, 400, 400, '#000000'), text('ghost', 0, 0, 200, 40, 32, '#FFFFFF', { opacity: 0.2 }), moved]);
    expect(t.map(x => x.id)).toEqual(['inner']);
    expect(t[0]?.x ?? 0).toBeGreaterThanOrEqual(40);
    const bare = withoutText([rect('bg', 0, 0, 400, 400, '#000000'), moved]);
    expect(JSON.stringify(bare)).not.toContain('"inner"');
    expect(bare).toHaveLength(2);
  });
});

describe('textOnGround', () => {
  const t: SeenText = { id: 'title', x: 0, y: 0, w: 100, h: 20, px: 40, bold: true, rgb: [255, 255, 255] };
  it('measures the share of the ground too close to the text, and how busy it is', () => {
    const [half] = textOnGround(split(100, 20, 250, 20), 100, 20, 100, 20, [t]);
    expect(half?.needs).toBe(3);
    expect(half?.below).toBe(0.5);
    expect(half?.busy).toBeGreaterThan(0.5);
    expect(legibilityNotes(half ? [half] : [])[0]).toMatch(/"title" \(40px\) is under 3:1 against a busy ground behind 50% of it/);
  });

  it('stays quiet on a ground that reads, and asks 4.5:1 of small type', () => {
    const [dark] = textOnGround(split(100, 20, 10, 20), 100, 20, 100, 20, [t]);
    expect(dark?.below).toBe(0);
    expect(legibilityNotes(dark ? [dark] : [])).toEqual([]);
    // White on grey 130 is 3.8:1 — enough for 40px bold, not for 14px regular.
    const [large, small] = textOnGround(split(100, 20, 130, 130), 100, 20, 100, 20, [t, { ...t, id: 'fine', px: 14, bold: false }]);
    expect(large?.below).toBe(0);
    expect(small?.needs).toBe(4.5);
    expect(small?.below).toBe(1);
  });
});

describe('the review reads text against what is really behind it (rendered)', () => {
  it('flags white copy running from a dark panel onto a light one, and not copy on the dark alone', () => {
    const W = 1200, H = 600;
    const spec = { meta: { name: 't', version: '1' }, document: { width: W, height: H, unit: 'px' }, layers: [
      rect('bg', 0, 0, W, H, '#F4F4F4'), rect('dark', 0, 0, 600, H, '#111111'),
      text('across', 100, 100, 1000, 120, 96, '#FFFFFF'), text('onDark', 60, 400, 400, 60, 40, '#FFFFFF'),
    ] } as unknown as DesignSpec;
    const [page] = reviewLayout(spec, '/tmp');
    expect(page?.legibility?.map(x => x.id)).toEqual(['across']);
    // 96px on a 600px-tall canvas is display size: its floor is 2:1, and white on #F4F4F4 is under it.
    expect(page?.notes.some(n => n.startsWith('"across" (96px) is under 2:1'))).toBe(true);
  }, 30_000);

  it('holds display type to 2:1, and leaves a moving page to its shots', () => {
    const W = 1080, H = 1920;
    const bg = rect('bg', 0, 0, W, H, '#E8452C');
    const three = text('three', 60, 150, 960, 760, 760, '#FFC53D');   // 2.5:1, a third of the screen
    const still = { meta: { name: 't', version: '1' }, document: { width: W, height: H, unit: 'px' }, layers: [bg, three] } as unknown as DesignSpec;
    expect(reviewLayout(still, '/tmp')[0]?.legibility).toBeUndefined();
    const moving = { ...still, layers: [bg, text('late', 60, 1200, 900, 80, 40, '#E8452C', {
      animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }], playback: { duration: 500, delay: 2000 } } })] } as unknown as DesignSpec;
    expect(reviewLayout(moving, '/tmp')[0]?.legibility).toBeUndefined();
  }, 30_000);
});
