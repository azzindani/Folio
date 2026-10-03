import { describe, it, expect } from 'vitest';
import { sourcePoint } from './clip-pick';

// A 1920×1080 frame shown in a 9:16 box (aspect 0.5625): cover keeps a 607.5 px wide strip of it.
const A = 9 / 16, W = 1920, H = 1080;
const near = (a: number | undefined, b: number): void => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(0.01);

describe('mapping a click on the box back to the clip\'s own picture', () => {
  it('cover, centred: the middle of the box is the middle of the frame', () => {
    const p = sourcePoint(0.5, 0.5, A, W, H, 'cover', [0.5, 0.5]);
    near(p?.x, 960); near(p?.y, 540);
  });
  it('cover follows the focus: at the left edge the box shows the frame\'s first 607.5 px, at the right its last', () => {
    near(sourcePoint(0, 0.5, A, W, H, 'cover', [0, 0.5])?.x, 0);
    near(sourcePoint(1, 0.5, A, W, H, 'cover', [0, 0.5])?.x, 607.5 - 0.0001);
    near(sourcePoint(0, 0.5, A, W, H, 'cover', [1, 0.5])?.x, 1920 - 607.5);
    near(sourcePoint(0.5, 0, A, W, H, 'cover', [0.5, 0.5])?.y, 0);
  });
  it('contain: the bars are not the picture; fill stretches; an own-size clip is not mapped', () => {
    expect(sourcePoint(0.5, 0.1, 1, W, H, 'contain', [0.5, 0.5])).toBeNull();
    near(sourcePoint(0.5, 0.5, 1, W, H, 'contain', [0.5, 0.5])?.y, 540);
    near(sourcePoint(0.25, 0.75, A, W, H, 'fill', [0.5, 0.5])?.x, 480);
    near(sourcePoint(0.25, 0.75, A, W, H, 'fill', [0.5, 0.5])?.y, 810);
    expect(sourcePoint(0.5, 0.5, A, W, H, 'none', [0.5, 0.5])).toBeNull();
  });
});
