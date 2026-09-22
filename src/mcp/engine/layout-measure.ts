// Layout measurement — how a page USES its canvas, in numbers.
//
// diagnose_design's other checks ask whether a design is broken (overlap,
// overflow, contrast). None asked how it spends its space, so a 1920×1080 page
// with its content bunched in one corner, or one card filling half the frame,
// passed clean — and the only way to see it was a preview image.
//
// This works on two renders of the same page: the GROUND alone (the full-bleed
// layers under everything) and the whole page. Where they differ is what a
// viewer sees on top of the ground — text, marks, images — whatever the layer
// types are. Everything here is pure math over those two pixel buffers.

export interface Grid {
  cols: number;
  rows: number;
  /** Per cell: share of its pixels that differ from the ground (0–1). */
  ink: Float32Array;
  /** Per cell: summed pixel difference — visual weight, for balance. */
  mass: Float32Array;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** A pixel counts as ink when a channel moved more than this (of 255). */
const PIXEL_DIFF = 24;
/** A cell is occupied when this share of it is ink — a line of body text
 *  inked into a 10 px cell covers well above it; anti-aliasing noise does not. */
export const CELL_OCCUPIED = 0.04;

/** Compare two RGBA renders of equal size and fold the difference into cells. */
export function inkGrid(full: Uint8Array, ground: Uint8Array, width: number, height: number, cols: number, rows: number): Grid {
  const ink = new Float32Array(cols * rows);
  const mass = new Float32Array(cols * rows);
  const count = new Float32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      const c = Math.min(cols - 1, Math.floor((x * cols) / width));
      const i = (y * width + x) * 4;
      const d = Math.max(
        Math.abs((full[i] ?? 0) - (ground[i] ?? 0)),
        Math.abs((full[i + 1] ?? 0) - (ground[i + 1] ?? 0)),
        Math.abs((full[i + 2] ?? 0) - (ground[i + 2] ?? 0)),
      );
      const k = r * cols + c;
      count[k] = (count[k] ?? 0) + 1;
      if (d > PIXEL_DIFF) { ink[k] = (ink[k] ?? 0) + 1; mass[k] = (mass[k] ?? 0) + d; }
    }
  }
  for (let k = 0; k < ink.length; k++) ink[k] = (count[k] ?? 0) > 0 ? (ink[k] ?? 0) / (count[k] ?? 1) : 0;
  return { cols, rows, ink, mass };
}

/** Occupied cells, grown by `radius` cells so the gaps inside a block of
 *  content (between lines, between cards) read as part of it, not as space. */
export function occupancy(g: Grid, radius = 1): Uint8Array {
  const raw = g.ink.map(v => (v >= CELL_OCCUPIED ? 1 : 0));
  const out = new Uint8Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!raw[r * g.cols + c]) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < g.rows && cc >= 0 && cc < g.cols) out[rr * g.cols + cc] = 1;
        }
      }
    }
  }
  return out;
}

/** Largest all-empty rectangle of a 0/1 grid (histogram method, O(cells)). */
export function largestEmpty(occ: Uint8Array, cols: number, rows: number): Rect | null {
  const heights = new Array<number>(cols).fill(0);
  let best: Rect | null = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = occ[r * cols + c] ? 0 : (heights[c] ?? 0) + 1;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? (heights[c] ?? 0) : 0;
      while (stack.length && (heights[stack[stack.length - 1] ?? 0] ?? 0) >= h) {
        const top = stack.pop() ?? 0;
        const height = heights[top] ?? 0;
        const left = stack.length ? (stack[stack.length - 1] ?? 0) + 1 : 0;
        const width = c - left;
        if (height > 0 && (!best || width * height > best.w * best.h)) best = { x: left, y: r - height + 1, w: width, h: height };
      }
      stack.push(c);
    }
  }
  return best;
}

/** The biggest empty rectangles, largest first, none overlapping, each at
 *  least `minShare` of the grid. */
export function emptyRects(occ: Uint8Array, cols: number, rows: number, minShare = 0.04, max = 3): Rect[] {
  const work = Uint8Array.from(occ);
  const out: Rect[] = [];
  while (out.length < max) {
    const r = largestEmpty(work, cols, rows);
    if (!r || (r.w * r.h) / (cols * rows) < minShare) break;
    out.push(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) work[y * cols + x] = 1;
  }
  return out;
}

export interface Balance {
  /** Centre of visual weight, 0–1 across and down the canvas. */
  centroid: { x: number; y: number };
  /** Its offset from the canvas centre (−0.5…0.5; + is right / down). */
  offset: { x: number; y: number };
  /** Share of the weight in the left / right half and the top / bottom half (%). */
  left_right: [number, number];
  top_bottom: [number, number];
}

export function balance(g: Grid): Balance | null {
  let total = 0, sx = 0, sy = 0, left = 0, top = 0;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const m = g.mass[r * g.cols + c] ?? 0;
      if (!m) continue;
      const cx = (c + 0.5) / g.cols, cy = (r + 0.5) / g.rows;
      total += m; sx += m * cx; sy += m * cy;
      if (cx < 0.5) left += m;
      if (cy < 0.5) top += m;
    }
  }
  if (!total) return null;
  const x = sx / total, y = sy / total;
  const pct = (v: number): number => Math.round((v / total) * 100);
  return {
    centroid: { x: round2(x), y: round2(y) },
    offset: { x: round2(x - 0.5), y: round2(y - 0.5) },
    left_right: [pct(left), 100 - pct(left)],
    top_bottom: [pct(top), 100 - pct(top)],
  };
}

/** Occupied share of each third of the canvas: rows top→bottom, cols left→right. */
export function thirds(occ: Uint8Array, cols: number, rows: number): number[][] {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const n = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tr = Math.min(2, Math.floor((r * 3) / rows)), tc = Math.min(2, Math.floor((c * 3) / cols));
      const row = out[tr], nrow = n[tr];
      if (!row || !nrow) continue;
      nrow[tc] = (nrow[tc] ?? 0) + 1;
      if (occ[r * cols + c]) row[tc] = (row[tc] ?? 0) + 1;
    }
  }
  return out.map((row, i) => row.map((v, j) => round2(v / Math.max(1, n[i]?.[j] ?? 1))));
}

/** The box around every occupied cell, in cells — null on an empty page. */
export function contentBox(occ: Uint8Array, cols: number, rows: number): Rect | null {
  let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occ[r * cols + c]) continue;
      x0 = Math.min(x0, c); y0 = Math.min(y0, r); x1 = Math.max(x1, c); y1 = Math.max(y1, r);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
