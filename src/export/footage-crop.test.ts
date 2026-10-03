import { describe, it, expect } from 'vitest';
import { resampleRegion, cropWindow } from './footage-crop';

/** A w×h RGBA ramp: red = x, green = y. */
const ramp = (w: number, h: number): Uint8Array => {
  const a = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set([x, y, 0, 255], (y * w + x) * 4);
  return a;
};

describe('resampleRegion', () => {
  it('a whole-pixel window of the output size is copied exactly', () => {
    const out = resampleRegion(ramp(10, 8), 10, 8, 3, 2, 4, 3, 4, 3);
    expect([...out.subarray(0, 4)]).toEqual([3, 2, 0, 255]);
    expect([...out.subarray((2 * 4 + 3) * 4, (2 * 4 + 3) * 4 + 4)]).toEqual([6, 4, 0, 255]);
  });
  it('a window twice the output size is sampled at its pixel centres', () => {
    const out = resampleRegion(ramp(16, 16), 16, 16, 0, 0, 8, 8, 4, 4);
    // Output pixel 0 covers source columns 0–1: it samples halfway between their centres (0.5 → rounds to 1).
    expect(out[0]).toBe(1);
    expect(out[3 * 4]).toBe(7);   // pixel 3 covers columns 6–7 → 6.5
  });
  it('enlarging stays inside the frame at its edges', () => {
    const out = resampleRegion(ramp(4, 4), 4, 4, 2, 2, 2, 2, 8, 8);
    expect(Math.max(...[...out].filter((_, i) => i % 4 === 0))).toBeLessThanOrEqual(3);
  });
});

describe('cropWindow', () => {
  it('zoom 1 centred: the box-aspect middle of a wider frame', () => {
    // 1920×1080 footage into a 1080×1920 (9:16) box, decoded at the file's own size.
    const w = cropWindow(1920, 1080, 1080, 1920, [0.5, 0.5], 1, 1);
    expect(w.rh).toBeCloseTo(1080, 6);
    expect(w.rw).toBeCloseTo(607.5, 6);
    expect(w.rx).toBeCloseTo((1920 - 607.5) / 2, 6);
  });
  it('focus [0, y] keeps the left edge; [1, y] the right; zoom 2 halves the window', () => {
    expect(cropWindow(1920, 1080, 1080, 1920, [0, 0.5], 1, 1).rx).toBeCloseTo(0, 6);
    const r = cropWindow(1920, 1080, 1080, 1920, [1, 0.5], 1, 1);
    expect(r.rx + r.rw).toBeCloseTo(1920, 6);
    const z = cropWindow(1920, 1080, 1920, 1080, [0.5, 0.5], 2, 1);
    expect([z.rw, z.rh, z.rx, z.ry].map(v => Math.round(v))).toEqual([960, 540, 480, 270]);
  });
});
