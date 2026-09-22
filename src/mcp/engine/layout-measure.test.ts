import { describe, it, expect } from 'vitest';
import { inkGrid, occupancy, largestEmpty, emptyRects, balance, thirds, contentBox } from './layout-measure';

/** A w×h RGBA page of one colour, with `paint` rects drawn black on top. */
function page(w: number, h: number, paint: Array<[number, number, number, number]> = []): Uint8Array {
  const px = new Uint8Array(w * h * 4).fill(255);
  for (const [x0, y0, pw, ph] of paint) {
    for (let y = y0; y < y0 + ph; y++) {
      for (let x = x0; x < x0 + pw; x++) { const i = (y * w + x) * 4; px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; }
    }
  }
  return px;
}

describe('inkGrid', () => {
  it('counts only what differs from the ground', () => {
    const ground = page(100, 100);
    const full = page(100, 100, [[0, 0, 50, 50]]);
    const g = inkGrid(full, ground, 100, 100, 10, 10);
    expect(g.ink[0]).toBe(1);             // top-left cell fully inked
    expect(g.ink[99]).toBe(0);            // bottom-right untouched
    expect([...g.ink].filter(v => v > 0)).toHaveLength(25);
  });

  it('reads a coloured ground as ground, not ink', () => {
    const ground = page(40, 40).map((v, i) => (i % 4 === 0 ? 30 : v));   // red-ish ground
    const g = inkGrid(Uint8Array.from(ground), Uint8Array.from(ground), 40, 40, 4, 4);
    expect([...g.ink].every(v => v === 0)).toBe(true);
  });
});

describe('occupancy + empty space', () => {
  it('grows content so gaps inside a block are not space', () => {
    const g = inkGrid(page(100, 100, [[0, 0, 10, 10], [20, 0, 10, 10]]), page(100, 100), 100, 100, 10, 10);
    const occ = occupancy(g, 1);
    expect(occ[1]).toBe(1);               // the gap between the two marks is filled
    expect(occ[5]).toBe(0);               // far away is not
  });

  it('finds the largest empty rectangle', () => {
    // Content in the left 3 columns only → the right 7×10 is empty.
    const occ = new Uint8Array(100);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) occ[r * 10 + c] = 1;
    expect(largestEmpty(occ, 10, 10)).toEqual({ x: 3, y: 0, w: 7, h: 10 });
  });

  it('lists non-overlapping empty rects above the share floor', () => {
    const occ = new Uint8Array(100);
    for (let c = 0; c < 10; c++) occ[5 * 10 + c] = 1;        // one full-width band at row 5
    const rects = emptyRects(occ, 10, 10, 0.04, 3);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 10, h: 5 });
    expect(rects[1]).toEqual({ x: 0, y: 6, w: 10, h: 4 });
    expect(rects).toHaveLength(2);
  });

  it('a full page has no empty rect', () => {
    expect(emptyRects(new Uint8Array(100).fill(1), 10, 10)).toEqual([]);
  });
});

describe('balance, thirds, content box', () => {
  it('puts the weight where the ink is', () => {
    const g = inkGrid(page(100, 100, [[60, 40, 40, 20]]), page(100, 100), 100, 100, 10, 10);
    const b = balance(g);
    expect(b?.offset.x).toBeCloseTo(0.3, 2);
    expect(b?.offset.y).toBeCloseTo(0, 2);
    expect(b?.left_right).toEqual([0, 100]);
  });

  it('an empty page has no balance', () => {
    expect(balance(inkGrid(page(20, 20), page(20, 20), 20, 20, 2, 2))).toBeNull();
  });

  it('reports occupancy per third and the content box', () => {
    const occ = new Uint8Array(81);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) occ[r * 9 + c] = 1;   // top-left third full
    const t = thirds(occ, 9, 9);
    expect(t[0]?.[0]).toBe(1);
    expect(t[2]?.[2]).toBe(0);
    expect(contentBox(occ, 9, 9)).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(contentBox(new Uint8Array(81), 9, 9)).toBeNull();
  });
});
