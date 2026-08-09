import { describe, it, expect } from 'vitest';
import { placeNear, unionRect, intersects, type Bounds } from './anchor-place';

// A 390×844 phone: toolbar + formula bar eat the top, the nav bar the bottom.
const PANE: Bounds = { top: 100, right: 386, bottom: 780, left: 4 };
const BAR = { width: 240, height: 48 };

describe('placeNear', () => {
  it('goes below the selection, because that is the side the hand comes from', () => {
    const p = placeNear({ x: 100, y: 200, width: 120, height: 80 }, BAR, PANE);
    expect(p.placement).toBe('below');
    expect(p.y).toBe(200 + 80 + 12);
  });

  it('centres on the selection', () => {
    const p = placeNear({ x: 100, y: 200, width: 120, height: 80 }, BAR, PANE);
    expect(p.x + BAR.width / 2).toBe(160);
  });

  it('flips above when there is no room below', () => {
    const p = placeNear({ x: 100, y: 600, width: 120, height: 160 }, BAR, PANE);
    expect(p.placement).toBe('above');
    expect(p.y + BAR.height).toBeLessThanOrEqual(600 - 11);
  });

  it('sits over the selection when it fills the pane, and stays inside', () => {
    const p = placeNear({ x: 0, y: 90, width: 390, height: 700 }, BAR, PANE);
    expect(p.placement).toBe('over');
    expect(p.y).toBeGreaterThanOrEqual(PANE.top);
    expect(p.y + BAR.height).toBeLessThanOrEqual(PANE.bottom);
  });

  it('never hangs off an edge, however far out the selection is', () => {
    for (const x of [-400, -40, 0, 200, 360, 900]) {
      const p = placeNear({ x, y: 300, width: 40, height: 40 }, BAR, PANE);
      expect(p.x).toBeGreaterThanOrEqual(PANE.left);
      expect(p.x + BAR.width).toBeLessThanOrEqual(PANE.right);
    }
  });

  it('degrades to the left/top edge when the surface is wider than the bounds', () => {
    const p = placeNear({ x: 10, y: 200, width: 50, height: 50 }, { width: 900, height: 48 }, PANE);
    expect(p.x).toBe(PANE.left);
  });
});

describe('unionRect', () => {
  it('is null with nothing selected', () => {
    expect(unionRect([])).toBeNull();
  });

  it('covers every rect in a multi-selection', () => {
    const u = unionRect([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 100, y: 50, width: 30, height: 10 },
    ]);
    expect(u).toEqual({ x: 10, y: 10, width: 120, height: 50 });
  });

  it('ignores rects with non-finite coordinates rather than poisoning the union', () => {
    const u = unionRect([
      { x: NaN, y: 0, width: 10, height: 10 },
      { x: 40, y: 40, width: 10, height: 10 },
    ]);
    expect(u).toEqual({ x: 40, y: 40, width: 10, height: 10 });
  });
});

describe('intersects', () => {
  it('is true for a selection inside the pane', () => {
    expect(intersects({ x: 100, y: 200, width: 50, height: 50 }, PANE)).toBe(true);
  });

  it('is false once the selection has been panned off the top', () => {
    expect(intersects({ x: 100, y: -200, width: 50, height: 50 }, PANE)).toBe(false);
  });

  it('is true while any sliver is still showing', () => {
    expect(intersects({ x: 100, y: 60, width: 50, height: 50 }, PANE)).toBe(true);
  });
});
