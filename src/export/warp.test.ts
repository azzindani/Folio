import { describe, it, expect } from 'vitest';
import { homography, invert3, warpOnto, cssMatrix3d, type Pixels, type Pt } from './warp';

const apply = (m: number[], [x, y]: Pt): Pt => {
  const w = (m[6] ?? 0) * x + (m[7] ?? 0) * y + (m[8] ?? 1);
  return [((m[0] ?? 0) * x + (m[1] ?? 0) * y + (m[2] ?? 0)) / w, ((m[3] ?? 0) * x + (m[4] ?? 0) * y + (m[5] ?? 0)) / w];
};
const blank = (w: number, h: number): Pixels => ({ width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4) });
/** A picture: left half opaque red, right half opaque blue (premultiplied). */
function halves(w: number, h: number): Pixels {
  const p = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    p.pixels.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], o);
  }
  return p;
}
const px = (p: Pixels, x: number, y: number): number[] => Array.from(p.pixels.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

describe('homography', () => {
  it('maps each corner where it was asked to, and its inverse maps back', () => {
    const src: Pt[] = [[0, 0], [100, 0], [100, 60], [0, 60]];
    const dst: Pt[] = [[10, 5], [90, 20], [85, 50], [12, 58]];
    const m = homography(src, dst);
    const inv = m ? invert3(m) : null;
    expect(m && inv).toBeTruthy();
    if (!m || !inv) return;
    src.forEach((p, i) => {
      const q = apply(m, p), back = apply(inv, q);
      expect(q[0]).toBeCloseTo(dst[i]?.[0] ?? NaN, 6);
      expect(q[1]).toBeCloseTo(dst[i]?.[1] ?? NaN, 6);
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    });
  });

  it('refuses a quad folded onto a line', () => {
    expect(homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]])).toBeNull();
  });
});

describe('warpOnto', () => {
  it('reproduces the picture exactly when the quad is its own rectangle', () => {
    const src = halves(20, 10), dst = blank(20, 10);
    warpOnto(dst, src, [[0, 0], [20, 0], [20, 10], [0, 10]]);
    expect(Array.from(dst.pixels)).toEqual(Array.from(src.pixels));
  });

  it('squeezes into a trapezoid: the near edge full height, the far edge shorter, nothing outside', () => {
    const src = halves(40, 40), dst = blank(40, 40);
    warpOnto(dst, src, [[0, 0], [40, 10], [40, 30], [0, 40]]);
    expect(px(dst, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(px(dst, 38, 3)).toEqual([0, 0, 0, 0]);
    expect(px(dst, 38, 20)).toEqual([0, 0, 255, 255]);
    // The seam between the halves moves toward the far (short) edge: perspective, not a plain squash.
    const row = Array.from({ length: 40 }, (_, x) => px(dst, x, 20)[0] ?? 0);
    const seam = row.findIndex(r => r < 128);
    expect(seam).toBeGreaterThan(20);
  });

  it('composites over what is there, and fades the outline by coverage', () => {
    const src = halves(10, 10), dst = blank(20, 20);
    dst.pixels.fill(255);
    warpOnto(dst, src, [[4.5, 4], [14.5, 4], [14.5, 14], [4.5, 14]]);
    expect(px(dst, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(px(dst, 6, 8)).toEqual([255, 0, 0, 255]);
    const edge = px(dst, 4, 8);
    expect(edge[0]).toBe(255);
    expect(edge[1]).toBeGreaterThan(100);
    expect(edge[1]).toBeLessThan(155);
  });
});

describe('cssMatrix3d', () => {
  it('sends each corner of the element where the quad puts it, as a browser applies it', () => {
    const quad: Pt[] = [[10, 5], [90, 20], [85, 50], [12, 58]];
    const css = cssMatrix3d(100, 60, quad) ?? '';
    const m = (/matrix3d\(([^)]+)\)/.exec(css)?.[1] ?? '').split(',').map(Number);
    expect(m).toHaveLength(16);
    // Column-major 4×4 on (x, y, 0, 1).
    const at = (x: number, y: number): Pt => {
      const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[15] ?? 0);
      return [((m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[12] ?? 0)) / w, ((m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[13] ?? 0)) / w];
    };
    ([[0, 0], [100, 0], [100, 60], [0, 60]] as Pt[]).forEach((p, i) => {
      const q = at(p[0], p[1]);
      expect(q[0]).toBeCloseTo(quad[i]?.[0] ?? NaN, 4);
      expect(q[1]).toBeCloseTo(quad[i]?.[1] ?? NaN, 4);
    });
  });
});
