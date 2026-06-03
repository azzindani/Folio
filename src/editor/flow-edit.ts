import type { FlowGridMetrics } from '../renderer/flow-layout';

// Pure geometry helpers for direct manipulation of flow-report components on
// the canvas. Kept separate from canvas.ts so they're unit-testable without a
// DOM: width→span snapping (resize) and reading-order insertion (reorder).

/** Rendered rectangle of a flow layer (canvas coords, post-computeFlowLayout). */
export interface FlowRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Snap a pixel width to the nearest grid span (1–12). Inverts flowSpanWidth:
 * width = s·colW + (s-1)·gap  ⇒  s = (width + gap) / (colW + gap).
 */
export function widthToSpan(px: number, m: FlowGridMetrics): number {
  const denom = m.colW + m.gap;
  if (denom <= 0) return 1;
  const s = Math.round((px + m.gap) / denom);
  return Math.max(1, Math.min(12, s));
}

/**
 * Reading-order insertion index for a drag-to-reorder drop. `rects` are the
 * OTHER top-level layers (dragged one excluded) in document order; the result
 * is the index at which the dragged layer should be re-inserted (0..n).
 *
 * A row-wrapped 12-col grid is laid out in document order, so we insert before
 * the first layer that sits "after" the cursor: either in a lower row, or in
 * the same row but past the cursor's x (compared against the layer's x-center).
 */
export function computeInsertIndex(rects: FlowRect[], cursor: { x: number; y: number }): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const aboveRow = cursor.y < r.y;
    const inBand = cursor.y >= r.y && cursor.y <= r.y + r.height;
    if (aboveRow) return i;
    if (inBand && cursor.x < r.x + r.width / 2) return i;
  }
  return rects.length;
}

/**
 * Where to draw the insertion indicator for a given target index — the left
 * edge of the target layer (full row height), or the right edge of the last
 * layer when dropping at the end. Returns null when there are no rects.
 */
export function insertIndicatorRect(
  rects: FlowRect[],
  targetIndex: number,
): { x: number; y: number; height: number } | null {
  if (rects.length === 0) return null;
  if (targetIndex >= rects.length) {
    const last = rects[rects.length - 1];
    return { x: last.x + last.width, y: last.y, height: last.height };
  }
  const r = rects[Math.max(0, targetIndex)];
  return { x: r.x, y: r.y, height: r.height };
}
