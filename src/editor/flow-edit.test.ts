import { describe, it, expect } from 'vitest';
import { widthToSpan, computeInsertIndex, insertIndicatorRect, type FlowRect } from './flow-edit';
import { flowGridMetrics, flowSpanWidth } from '../renderer/flow-layout';

const M = flowGridMetrics({ containerWidth: 1200 });

describe('widthToSpan', () => {
  it('round-trips every span 1–12 through its pixel width', () => {
    for (let s = 1; s <= 12; s++) {
      expect(widthToSpan(flowSpanWidth(s, M), M)).toBe(s);
    }
  });
  it('snaps to the nearest column and clamps to 1–12', () => {
    expect(widthToSpan(1, M)).toBe(1);          // tiny → 1
    expect(widthToSpan(100000, M)).toBe(12);    // huge → 12
    // halfway between span 3 and 4 rounds up
    const mid = (flowSpanWidth(3, M) + flowSpanWidth(4, M)) / 2;
    expect(widthToSpan(mid + 1, M)).toBe(4);
  });
});

describe('computeInsertIndex', () => {
  // Two rows: [a b c] on row 1 (y=0..120), [d e] on row 2 (y=140..260).
  const rects: FlowRect[] = [
    { id: 'a', x: 40, y: 0, width: 360, height: 120 },
    { id: 'b', x: 420, y: 0, width: 360, height: 120 },
    { id: 'c', x: 800, y: 0, width: 360, height: 120 },
    { id: 'd', x: 40, y: 140, width: 360, height: 120 },
    { id: 'e', x: 420, y: 140, width: 360, height: 120 },
  ];
  it('inserts at the front when the cursor is above everything', () => {
    expect(computeInsertIndex(rects, { x: 50, y: -20 })).toBe(0);
  });
  it('inserts before a layer when the cursor is left of its x-center, same row', () => {
    expect(computeInsertIndex(rects, { x: 430, y: 60 })).toBe(1); // just inside b's left half
  });
  it('inserts after the last item of a row when cursor is past its center', () => {
    expect(computeInsertIndex(rects, { x: 1100, y: 60 })).toBe(3); // past c → start of row 2
  });
  it('inserts within the second row', () => {
    expect(computeInsertIndex(rects, { x: 430, y: 200 })).toBe(4); // before e
  });
  it('appends to the end when the cursor is below everything', () => {
    expect(computeInsertIndex(rects, { x: 900, y: 400 })).toBe(5);
  });
});

describe('insertIndicatorRect', () => {
  const rects: FlowRect[] = [
    { id: 'a', x: 40, y: 0, width: 360, height: 120 },
    { id: 'b', x: 420, y: 0, width: 360, height: 120 },
  ];
  it('marks the left edge of the target layer', () => {
    expect(insertIndicatorRect(rects, 1)).toEqual({ x: 420, y: 0, height: 120 });
  });
  it('marks the right edge of the last layer when dropping at the end', () => {
    expect(insertIndicatorRect(rects, 2)).toEqual({ x: 780, y: 0, height: 120 });
  });
  it('returns null with no rects', () => {
    expect(insertIndicatorRect([], 0)).toBeNull();
  });
});
