import { describe, it, expect } from 'vitest';
import { revealInset, revealRect, REVEAL_BLEED } from './reveal';

const box = { x: 100, y: 50, width: 400, height: 200 };

describe('revealRect', () => {
  it('hides everything, overhang included, at reveal 0', () => {
    // The open side still reaches far out; the wiping edge sits the bleed BEFORE the box.
    const r = revealRect(box, 0, 'left');
    expect((r?.x ?? 0) + (r?.width ?? 0)).toBe(box.x - REVEAL_BLEED);
  });

  it('wipes from the left: halfway uncovers the left half', () => {
    const r = revealRect(box, 0.5, 'left');
    expect(r?.x).toBeLessThan(box.x);            // the side that is not wiping stays open
    expect((r?.x ?? 0) + (r?.width ?? 0)).toBe(300); // edge at the middle of the box
  });

  it('wipes from the bottom and irises from the centre', () => {
    const up = revealRect(box, 0.25, 'bottom');
    expect(up?.y).toBeCloseTo(50 + 200 * 0.75 + REVEAL_BLEED * 0.5, 5);
    const iris = revealRect(box, 0.5, 'center');
    expect(iris?.x).toBeCloseTo(100 + 400 * 0.25, 5);
    expect(iris?.width).toBeCloseTo(200, 5);
  });

  it('carries no clip at all once fully revealed', () => {
    expect(revealRect(box, 1, 'right')).toBeNull();
  });
});

describe('revealInset', () => {
  it('overshoots the box at rest, so an outside stroke is whole', () => {
    expect(revealInset(1, 'left').right).toEqual({ frac: 0, px: -REVEAL_BLEED });
    expect(revealInset(0, 'top').bottom).toEqual({ frac: 1, px: REVEAL_BLEED });
  });
});
