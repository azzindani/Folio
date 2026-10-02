import { describe, it, expect } from 'vitest';
import { clipRect, overBand, drawClip } from './footage-composite';

const px = (...v: number[]): Buffer => Buffer.from(v);

describe('clipRect', () => {
  it('scales the box and rounds edges, so two boxes that touch still touch', () => {
    expect(clipRect(0, 0, 1920, 1080, 0.5)).toEqual({ x: 0, y: 0, w: 960, h: 540 });
    const a = clipRect(0, 0, 333, 10, 0.5), b = clipRect(333, 0, 333, 10, 0.5);
    expect(a.x + a.w).toBe(b.x);
  });
});

describe('overBand — premultiplied source-over', () => {
  it('skips transparent pixels, replaces opaque ones, blends the rest', () => {
    const dst = px(10, 20, 30, 255, 10, 20, 30, 255, 200, 200, 200, 255);
    overBand(dst, px(0, 0, 0, 0, 1, 2, 3, 255, 128, 0, 0, 128));
    expect(Array.from(dst)).toEqual([10, 20, 30, 255, 1, 2, 3, 255, 228, 100, 100, 255]);
  });
});

describe('drawClip — straight-alpha clip over a premultiplied frame', () => {
  it('copies an opaque clip into its rectangle and leaves the rest', () => {
    const dst = Buffer.alloc(3 * 2 * 4, 255);            // 3×2 white
    const clip = px(1, 2, 3, 255, 4, 5, 6, 255);           // 2×1
    drawClip(dst, 3, 2, clip, 2, 1, 1, 1, 1);
    expect(Array.from(dst.subarray(16, 24))).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(Array.from(dst.subarray(0, 16))).toEqual(new Array(16).fill(255));
  });
  it('fades by opacity and by the clip\'s own alpha (contain padding is transparent)', () => {
    const dst = px(0, 0, 0, 255, 0, 0, 0, 255);
    drawClip(dst, 2, 1, px(255, 255, 255, 255, 255, 255, 255, 0), 2, 1, 0, 0, 0.5);
    expect(Array.from(dst)).toEqual([128, 128, 128, 255, 0, 0, 0, 255]);
  });
  it('cuts a clip that hangs off the frame', () => {
    const dst = Buffer.alloc(2 * 1 * 4, 0);
    drawClip(dst, 2, 1, px(9, 9, 9, 255, 8, 8, 8, 255), 2, 1, -1, 0, 1);
    expect(Array.from(dst)).toEqual([8, 8, 8, 255, 0, 0, 0, 0]);
  });
});
