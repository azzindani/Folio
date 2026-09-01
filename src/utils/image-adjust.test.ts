import { describe, it, expect } from 'vitest';
import type { RasterImage } from './png-codec';
import { adjust, brightness, contrast, saturation, hueRotate, invert, threshold, posterize, duotone, levels, hasAdjust, hexToRgb } from './image-adjust';
import { crop, cropToAspect, parseAspect, flip, rotate90, trim, pad, roundCorners, flatten, opaqueBounds } from './image-geometry';
import { gaussianBlur, sharpen, vignette, grain } from './image-filters';

function solid(w: number, h: number, rgba: [number, number, number, number]): RasterImage {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = rgba[0]; px[i + 1] = rgba[1]; px[i + 2] = rgba[2]; px[i + 3] = rgba[3]; }
  return { width: w, height: h, pixels: px };
}
const at = (img: RasterImage, x: number, y: number): number[] => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('image-adjust', () => {
  it('brightness and contrast move mid-grey the expected way', () => {
    const a = solid(2, 2, [100, 100, 100, 255]);
    brightness(a, 20); expect(at(a, 0, 0)[0]).toBe(151);
    const b = solid(1, 1, [100, 100, 100, 255]);
    contrast(b, 50); expect(at(b, 0, 0)[0]).toBeLessThan(100);
    const c = solid(1, 1, [200, 200, 200, 255]);
    contrast(c, 50); expect(at(c, 0, 0)[0]).toBeGreaterThan(200);
  });

  it('saturation 0 is grayscale; invert flips; threshold binarises', () => {
    const a = solid(1, 1, [200, 50, 50, 255]);
    saturation(a, 0);
    const [r, g, b] = at(a, 0, 0);
    expect(r).toBe(g); expect(g).toBe(b);
    const i = solid(1, 1, [10, 20, 30, 255]); invert(i); expect(at(i, 0, 0).slice(0, 3)).toEqual([245, 235, 225]);
    const t = solid(1, 2, [10, 10, 10, 255]); t.pixels.set([250, 250, 250, 255], 4); threshold(t, 128);
    expect(at(t, 0, 0)[0]).toBe(0); expect(at(t, 0, 1)[0]).toBe(255);
  });

  it('hue rotation by 360 is identity and 180 swaps toward the complement', () => {
    const a = solid(1, 1, [200, 40, 40, 255]); hueRotate(a, 360);
    expect(at(a, 0, 0)[0]).toBeGreaterThan(190);
    const b = solid(1, 1, [200, 40, 40, 255]); hueRotate(b, 180);
    expect(at(b, 0, 0)[0]).toBeLessThan(at(b, 0, 0)[1]);
  });

  it('levels, posterize and duotone remap tones', () => {
    const l = solid(1, 1, [64, 64, 64, 255]); levels(l, 64, 192); expect(at(l, 0, 0)[0]).toBe(0);
    const p = solid(1, 1, [100, 100, 100, 255]); posterize(p, 2); expect([0, 255]).toContain(at(p, 0, 0)[0]);
    const d = solid(1, 2, [0, 0, 0, 255]); d.pixels.set([255, 255, 255, 255], 4);
    duotone(d, '#102030', '#f0e0d0');
    expect(at(d, 0, 0).slice(0, 3)).toEqual([16, 32, 48]);
    expect(at(d, 0, 1).slice(0, 3)).toEqual([240, 224, 208]);
  });

  it('adjust() applies a spec and reports notes; hasAdjust ignores empties', () => {
    const a = solid(2, 1, [120, 120, 120, 255]);
    const notes = adjust(a, { brightness: 10, saturation: 0, invert: true });
    expect(notes).toEqual(['brightness 10', 'grayscale', 'inverted']);
    expect(hasAdjust({})).toBe(false);
    expect(hasAdjust({ gamma: 1.2 })).toBe(true);
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
  });
});

describe('image-geometry', () => {
  it('crop, aspect crop and parseAspect', () => {
    const img = solid(10, 6, [1, 2, 3, 255]);
    img.pixels.set([9, 9, 9, 255], (2 * 10 + 3) * 4);
    const c = crop(img, 3, 2, 4, 2);
    expect([c.width, c.height]).toEqual([4, 2]);
    expect(at(c, 0, 0)[0]).toBe(9);
    expect(parseAspect('16:9')).toBeCloseTo(16 / 9);
    expect(parseAspect('bad')).toBeNull();
    const sq = cropToAspect(img, 1);
    expect([sq.width, sq.height]).toEqual([6, 6]);
    const left = cropToAspect(img, 1, 'left');
    expect(at(left, 3, 2)[0]).toBe(9); // anchored left keeps x=3
  });

  it('flip and rotate90 move a marked pixel where expected', () => {
    const img = solid(3, 2, [0, 0, 0, 255]);
    img.pixels.set([7, 7, 7, 255], 0); // top-left marker
    expect(at(flip(img, true, false), 2, 0)[0]).toBe(7);
    expect(at(flip(img, false, true), 0, 1)[0]).toBe(7);
    const cw = rotate90(img, 90);
    expect([cw.width, cw.height]).toEqual([2, 3]);
    expect(at(cw, 1, 0)[0]).toBe(7);   // top-left → top-right
    const ccw = rotate90(img, -90);
    expect(at(ccw, 0, 2)[0]).toBe(7);  // top-left → bottom-left
    expect(at(rotate90(img, 180), 2, 1)[0]).toBe(7);
  });

  it('trim, pad, round corners and flatten', () => {
    const img = solid(6, 6, [0, 0, 0, 0]);
    img.pixels.set([5, 5, 5, 255], (2 * 6 + 2) * 4);
    img.pixels.set([5, 5, 5, 255], (3 * 6 + 3) * 4);
    expect(opaqueBounds(img)).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    const t = trim(img, 1);
    expect([t.width, t.height]).toEqual([4, 4]);
    const p = pad(t, 2, [255, 0, 0, 255]);
    expect([p.width, p.height]).toEqual([8, 8]);
    expect(at(p, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    const r = roundCorners(solid(10, 10, [1, 1, 1, 255]), 4);
    expect(at(r, 0, 0)[3]).toBe(0);
    expect(at(r, 5, 5)[3]).toBe(255);
    const f = flatten(solid(1, 1, [255, 255, 255, 0]), [10, 20, 30]);
    expect(at(f, 0, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe('image-filters', () => {
  it('blur spreads an impulse, sharpen exaggerates an edge, vignette darkens corners, grain is deterministic', () => {
    const img = solid(9, 9, [0, 0, 0, 255]);
    img.pixels.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
    const b = gaussianBlur(img, 2);
    expect(at(b, 4, 4)[0]).toBeLessThan(255);
    expect(at(b, 4, 5)[0]).toBeGreaterThan(0);
    const edge = solid(4, 1, [0, 0, 0, 255]); edge.pixels.set([200, 200, 200, 255, 200, 200, 200, 255], 8);
    const s = sharpen(edge, 2, 1);
    expect(at(s, 2, 0)[0]).toBeGreaterThanOrEqual(200);
    const v = vignette(solid(20, 20, [200, 200, 200, 255]), 1, 0.9);
    expect(at(v, 0, 0)[0]).toBeLessThan(at(v, 10, 10)[0]);
    const g1 = grain(solid(4, 4, [128, 128, 128, 255]), 0.5, 3);
    const g2 = grain(solid(4, 4, [128, 128, 128, 255]), 0.5, 3);
    expect(Array.from(g1.pixels)).toEqual(Array.from(g2.pixels));
    expect(Array.from(g1.pixels).some(v => v !== 128 && v !== 255)).toBe(true);
  });
});
