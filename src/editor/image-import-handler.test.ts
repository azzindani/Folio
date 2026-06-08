import { describe, it, expect } from 'vitest';
import { makeReferenceLayer } from './image-import-handler';

describe('makeReferenceLayer', () => {
  it('fits a wide image inside a square canvas, centered, behind + locked', () => {
    const l = makeReferenceLayer('data:img', 2000, 1000, 'ref-1', 1080, 1080);
    expect(l.role).toBe('reference');
    expect(l.locked).toBe(true);
    expect(l.opacity).toBe(0.4);
    expect(l.z).toBe(0);
    expect(l.fit).toBe('contain');
    // contain: width fills 1080, height scales to 540, vertically centered
    expect(l.width).toBe(1080);
    expect(l.height).toBe(540);
    expect(l.x).toBe(0);
    expect(l.y).toBe(270);
  });

  it('fits a tall image inside a portrait canvas', () => {
    const l = makeReferenceLayer('data:img', 1000, 2000, 'ref-2', 1080, 1350);
    // contain by height: scale = 1350/2000 = 0.675 → 675 x 1350
    expect(l.height).toBe(1350);
    expect(l.width).toBe(675);
    expect(l.x).toBe(Math.round((1080 - 675) / 2));
    expect(l.y).toBe(0);
  });

  it('guards against zero-sized images', () => {
    const l = makeReferenceLayer('data:img', 0, 0, 'ref-3', 1080, 1080);
    expect(Number.isFinite(l.width as number)).toBe(true);
  });
});
