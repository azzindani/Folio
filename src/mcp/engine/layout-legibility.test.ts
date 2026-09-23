import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { seenTexts, textMask, textOnGround, legibilityNotes, type SeenText } from './layout-legibility';
import { reviewLayout } from './layout-review';

const text = (id: string, x: number, y: number, w: number, h: number, size: number, color: string, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: w, height: h, content: { type: 'plain', value: 'READ ME PLEASE' }, style: { font_size: size, color, font_weight: 700 }, ...extra }) as unknown as Layer;
const rect = (id: string, x: number, y: number, w: number, h: number, color: string, extra: object = {}): Layer =>
  ({ id, type: 'rect', z: 1, x, y, width: w, height: h, fill: { type: 'solid', color }, ...extra }) as unknown as Layer;

/** A 100×20 scene: a ground grey per pixel, one 60×8 "glyph" bar in the middle painted `ink`, and its mask. */
function scene(ground: (x: number, y: number) => number, ink: number | null, halo?: number): { full: Uint8Array; mask: Uint8Array } {
  const W = 100, H = 20, full = new Uint8Array(W * H * 4), mask = new Uint8Array(W * H * 4);
  const inGlyph = (x: number, y: number): boolean => x >= 20 && x < 80 && y >= 6 && y < 14;
  const nearGlyph = (x: number, y: number): boolean => x >= 17 && x < 83 && y >= 3 && y < 17;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, g = inGlyph(x, y);
    const v = g && ink !== null ? ink : halo !== undefined && nearGlyph(x, y) ? halo : ground(x, y);
    full[i] = full[i + 1] = full[i + 2] = v; full[i + 3] = 255;
    mask[i] = mask[i + 1] = mask[i + 2] = g ? 0 : 255; mask[i + 3] = 255;
  }
  return { full, mask };
}
const t: SeenText = { id: 'title', x: 0, y: 0, w: 100, h: 20, px: 40, bold: true, rgb: [255, 255, 255] };
const read = (s: { full: Uint8Array; mask: Uint8Array }, text: SeenText = t) => textOnGround(s.full, s.mask, 100, 20, 100, 20, [text])[0];

describe('seenTexts + textMask', () => {
  it('finds the texts a viewer reads — skipping faint ones, carrying a posed group — and masks only glyphs', () => {
    const moved = { id: 'g', type: 'group', z: 2, x: 0, y: 0, width: 100, height: 100, fill: '#FF0000', _frame_pose: { dx: 40, dy: 0, scale_x: 1, scale_y: 1 },
      layers: [text('inner', 0, 0, 200, 40, 32, '#FFFFFF', { effects: { shadows: [{ x: 0, y: 2, blur: 4, color: '#000' }] } })] } as unknown as Layer;
    const t2 = seenTexts([rect('bg', 0, 0, 400, 400, '#000000'), text('ghost', 0, 0, 200, 40, 32, '#FFFFFF', { opacity: 0.2 }), moved]);
    expect(t2.map(x => x.id)).toEqual(['inner']);
    expect(t2[0]?.x ?? 0).toBeGreaterThanOrEqual(40);
    const m = textMask([rect('bg', 0, 0, 400, 400, '#000000'), moved]);
    expect(m).toHaveLength(1);
    const g = m[0] as unknown as { fill?: unknown; _frame_pose?: unknown; layers: Array<{ style: { color: string }; effects?: unknown }> };
    expect(g.fill).toBeUndefined();
    expect(g._frame_pose).toBeDefined();
    expect(g.layers[0]?.style.color).toBe('#000000');
    expect(g.layers[0]?.effects).toBeUndefined();
  });
});

describe('textOnGround — letters as seen against what surrounds them', () => {
  it('white letters running from dark ground onto white: about half their edges fail', () => {
    const r = read(scene(x => (x < 50 ? 20 : 250), 255));
    expect(r?.needs).toBe(3);
    expect(r?.below ?? 0).toBeGreaterThan(0.35);
    expect(r?.below ?? 1).toBeLessThan(0.65);
    expect(r?.busy ?? 0).toBeGreaterThan(0.5);
    expect(legibilityNotes(r ? [r] : [])[0]).toMatch(/"title" \(40px\) reads under 3:1 against a busy ground along \d+% of its letters' edges/);
  });

  it('passes letters that read, and fails letters something is painted over', () => {
    expect(read(scene(() => 20, 255))?.below).toBe(0);
    expect(read(scene(() => 90, 95))?.below).toBe(1);        // covered: letters and ground seen alike
  });

  it('credits a shadow halo that lifts white letters off a white ground', () => {
    expect(read(scene(() => 250, 255))?.below).toBe(1);
    expect(read(scene(() => 250, 255, 20))?.below).toBe(0);
  });

  it('asks 4.5:1 of small type and 3:1 of large', () => {
    const s = scene(() => 130, 255);                          // white on grey 130 ≈ 3.8:1
    expect(read(s)?.below).toBe(0);
    expect(read(s, { ...t, px: 14, bold: false })?.needs).toBe(4.5);
    expect(read(s, { ...t, px: 14, bold: false })?.below).toBe(1);
  });
});

describe('the review reads text as seen (rendered)', () => {
  const W = 1200, H = 600;
  const spec = (layers: Layer[]): DesignSpec => ({ meta: { name: 't', version: '1' }, document: { width: W, height: H, unit: 'px' }, layers }) as unknown as DesignSpec;

  it('flags white copy running from a dark panel onto a light one, and not copy on the dark alone', () => {
    const [page] = reviewLayout(spec([rect('bg', 0, 0, W, H, '#F4F4F4'), rect('dark', 0, 0, 600, H, '#111111'),
      text('across', 100, 100, 1000, 120, 96, '#FFFFFF'), text('onDark', 60, 400, 400, 60, 40, '#FFFFFF')]), '/tmp');
    expect(page?.legibility?.map(x => x.id)).toEqual(['across']);
    expect(page?.notes.some(n => n.startsWith('"across" (96px) reads under 2:1'))).toBe(true);
  }, 30_000);

  it('a scrim painted OVER the words fails them; the same scrim under them passes (A1 live check)', () => {
    const scrim = (z: number): Layer => rect('scrim', 0, 300, W, 300, '#0B1A2E', { z, opacity: 0.7 });
    const words = { ...text('sub', 80, 420, 1000, 60, 40, '#FFFFFF'), z: 3 } as Layer;
    const over = reviewLayout(spec([rect('bg', 0, 0, W, H, '#F4F4F4'), words, scrim(4)]), '/tmp')[0];
    expect(over?.legibility?.map(x => x.id)).toEqual(['sub']);
    const under = reviewLayout(spec([rect('bg', 0, 0, W, H, '#F4F4F4'), scrim(2), words]), '/tmp')[0];
    expect(under?.legibility).toBeUndefined();
  }, 30_000);

  it('holds display type to 2:1, and leaves a moving page to its shots', () => {
    const W2 = 1080, H2 = 1920;
    const bg = rect('bg', 0, 0, W2, H2, '#E8452C');
    const three = text('three', 60, 150, 960, 760, 760, '#FFC53D');   // 2.5:1, a third of the screen
    const still = { meta: { name: 't', version: '1' }, document: { width: W2, height: H2, unit: 'px' }, layers: [bg, three] } as unknown as DesignSpec;
    expect(reviewLayout(still, '/tmp')[0]?.legibility).toBeUndefined();
    const moving = { ...still, layers: [bg, text('late', 60, 1200, 900, 80, 40, '#E8452C', {
      animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }], playback: { duration: 500, delay: 2000 } } })] } as unknown as DesignSpec;
    expect(reviewLayout(moving, '/tmp')[0]?.legibility).toBeUndefined();
  }, 30_000);
});
