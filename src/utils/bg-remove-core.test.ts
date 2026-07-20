import { describe, it, expect } from 'vitest';
import { removeBackgroundPixels, detectBackgroundColor, featherAlpha } from './bg-remove-core';

/** An image with a solid border colour and a differently-coloured centre block. */
function subjectOnBackground(
  size: number,
  bg: [number, number, number],
  fg: [number, number, number],
  inset = 2,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inSubject = x >= inset && y >= inset && x < size - inset && y < size - inset;
      const c = inSubject ? fg : bg;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

const alphaAt = (px: Uint8ClampedArray, size: number, x: number, y: number): number =>
  px[(y * size + x) * 4 + 3];

describe('detectBackgroundColor', () => {
  it('reads the border colour', () => {
    const px = subjectOnBackground(8, [255, 255, 255], [10, 20, 30]);
    expect(detectBackgroundColor(px, 8, 8)).toEqual([255, 255, 255]);
  });

  it('ignores an outlier corner instead of averaging it in', () => {
    // The original averaged the four corners, so a single dark corner — a
    // vignette, or a mark that clips the edge — dragged the target colour away
    // from the actual backdrop and the fill then matched nothing.
    const px = subjectOnBackground(16, [250, 250, 250], [10, 20, 30]);
    px[0] = 0; px[1] = 0; px[2] = 0; // one black corner pixel
    expect(detectBackgroundColor(px, 16, 16)).toEqual([250, 250, 250]);
  });
});

describe('removeBackgroundPixels', () => {
  it('clears the background and keeps the subject opaque', () => {
    const size = 10;
    const px = subjectOnBackground(size, [255, 255, 255], [210, 98, 42]);
    const stats = removeBackgroundPixels(px, size, size, { feather: 0 });

    expect(alphaAt(px, size, 0, 0)).toBe(0);       // corner: background
    expect(alphaAt(px, size, 5, 5)).toBe(255);     // centre: subject
    expect(stats.removed).toBeGreaterThan(0);
    expect(stats.background).toEqual([255, 255, 255]);
  });

  it('leaves colour channels untouched, changing only alpha', () => {
    const size = 8;
    const px = subjectOnBackground(size, [255, 255, 255], [210, 98, 42]);
    removeBackgroundPixels(px, size, size, { feather: 0 });
    const i = (5 * size + 5) * 4;
    expect([px[i], px[i + 1], px[i + 2]]).toEqual([210, 98, 42]);
  });

  it('does not reach an enclosed region of the background colour', () => {
    // The hole in a letter "O" is the same white as the backdrop but is not
    // connected to the border. Removing it would punch through the subject.
    const size = 12;
    const px = subjectOnBackground(size, [255, 255, 255], [0, 0, 0], 2);
    const hole = (6 * size + 6) * 4;
    px[hole] = 255; px[hole + 1] = 255; px[hole + 2] = 255;

    removeBackgroundPixels(px, size, size, { feather: 0 });
    expect(alphaAt(px, size, 6, 6)).toBe(255);
  });

  it('respects tolerance — a near-background shade goes with a loose setting', () => {
    const size = 8;
    const near = subjectOnBackground(size, [255, 255, 255], [250, 250, 250]);
    removeBackgroundPixels(near, size, size, { tolerance: 20, feather: 0 });
    expect(alphaAt(near, size, 4, 4)).toBe(0);

    const strict = subjectOnBackground(size, [255, 255, 255], [250, 250, 250]);
    removeBackgroundPixels(strict, size, size, { tolerance: 2, feather: 0 });
    expect(alphaAt(strict, size, 4, 4)).toBe(255);
  });

  it('reports the fraction removed', () => {
    const size = 10;
    const px = subjectOnBackground(size, [255, 255, 255], [0, 0, 0], 2);
    const stats = removeBackgroundPixels(px, size, size, { feather: 0 });
    // A 2px border of a 10x10 image is 100 - 36 = 64 pixels.
    expect(stats.removedFraction).toBeCloseTo(0.64, 2);
  });

  it('handles an image that is entirely background', () => {
    const size = 6;
    const px = subjectOnBackground(size, [255, 255, 255], [255, 255, 255]);
    const stats = removeBackgroundPixels(px, size, size, { feather: 0 });
    expect(stats.removedFraction).toBe(1);
  });

  it('does not blow the stack on a large image', () => {
    // The fill is iterative for exactly this reason.
    const size = 400;
    const px = subjectOnBackground(size, [255, 255, 255], [0, 0, 0], 10);
    expect(() => removeBackgroundPixels(px, size, size, { feather: 0 })).not.toThrow();
  });
});

describe('featherAlpha', () => {
  it('softens a hard alpha edge without touching colour', () => {
    const size = 8;
    const px = subjectOnBackground(size, [255, 255, 255], [0, 0, 0], 2);
    removeBackgroundPixels(px, size, size, { feather: 0 });
    const before = alphaAt(px, size, 2, 4);
    featherAlpha(px, size, size, 1);
    expect(alphaAt(px, size, 2, 4)).toBeLessThan(before);
    const i = (4 * size + 4) * 4;
    expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 0]);
  });
});
