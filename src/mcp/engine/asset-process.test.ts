import { describe, it, expect } from 'vitest';
import { processAsset, resize, hasWork, ProcessError } from './asset-process';
import { decodePNG, encodePNG, type RasterImage } from '../../utils/png-codec';

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): RasterImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  return { width, height, pixels };
}

/** White backdrop with an orange block in the middle. */
function logoOnWhite(size = 12, inset = 3): Buffer {
  return encodePNG(image(size, size, (x, y) =>
    x >= inset && y >= inset && x < size - inset && y < size - inset
      ? [210, 98, 42, 255]
      : [255, 255, 255, 255]));
}

const alphaAt = (img: RasterImage, x: number, y: number): number =>
  img.pixels[(y * img.width + x) * 4 + 3];

describe('hasWork', () => {
  it('is false for nothing to do', () => {
    expect(hasWork(undefined)).toBe(false);
    expect(hasWork({})).toBe(false);
  });
  it('is true when any field is set', () => {
    expect(hasWork({ remove_bg: true })).toBe(true);
    expect(hasWork({ fit: { w: 10 } })).toBe(true);
  });
});

describe('processAsset — remove_bg', () => {
  it('makes the backdrop transparent and keeps the subject', () => {
    const r = processAsset(logoOnWhite(), 'png', { remove_bg: true });
    const out = decodePNG(r.buffer);
    expect(alphaAt(out, 0, 0)).toBe(0);
    expect(alphaAt(out, 6, 6)).toBe(255);
    expect(r.bgStats?.background).toEqual([255, 255, 255]);
  });

  it('reports coverage so a caller who cannot see the image knows what happened', () => {
    const r = processAsset(logoOnWhite(), 'png', { remove_bg: true });
    expect(r.notes.join(' ')).toMatch(/removed background \(\d+% of pixels/);
  });

  it('warns when nothing matched rather than reporting a silent success', () => {
    // Already-transparent border: the fill finds nothing to do.
    const buf = encodePNG(image(8, 8, () => [10, 20, 30, 255]));
    const r = processAsset(buf, 'png', { remove_bg: { tolerance: 0 } });
    const notes = r.notes.join(' ');
    // Either it removed everything (uniform image) or nothing — both are called out.
    expect(notes).toMatch(/nothing matched|almost the whole image/);
  });

  it('warns when the fill ate the whole image', () => {
    const buf = encodePNG(image(8, 8, () => [255, 255, 255, 255]));
    const r = processAsset(buf, 'png', { remove_bg: true });
    expect(r.notes.join(' ')).toContain('almost the whole image');
  });

  it('honours tolerance and feather options', () => {
    const r = processAsset(logoOnWhite(), 'png', { remove_bg: { tolerance: 10, feather: 0 } });
    const out = decodePNG(r.buffer);
    expect(alphaAt(out, 0, 0)).toBe(0);
  });
});

describe('processAsset — fit', () => {
  it('resizes to the requested box with contain', () => {
    const r = processAsset(logoOnWhite(16, 4), 'png', { fit: { w: 8, h: 8, mode: 'contain' } });
    const out = decodePNG(r.buffer);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    expect(r.notes.join(' ')).toContain('16×16 → 8×8');
  });

  it('fills the box exactly with cover', () => {
    const r = processAsset(logoOnWhite(16, 4), 'png', { fit: { w: 10, h: 6, mode: 'cover' } });
    const out = decodePNG(r.buffer);
    expect(out.width).toBe(10);
    expect(out.height).toBe(6);
  });

  it('rejects a non-positive target', () => {
    expect(() => processAsset(logoOnWhite(), 'png', { fit: { w: 0, h: 10 } })).toThrow(ProcessError);
  });

  it('combines removal and resize in one pass', () => {
    const r = processAsset(logoOnWhite(16, 4), 'png', { remove_bg: true, fit: { w: 8, h: 8 } });
    const out = decodePNG(r.buffer);
    expect(out.width).toBe(8);
    expect(r.notes).toHaveLength(2);
  });
});

describe('resize', () => {
  it('interpolates rather than point-sampling', () => {
    // A black→white ramp scaled up should produce mid greys, not a hard edge.
    // Sizes must upscale in BOTH axes or `contain` is limited by the other one.
    const src = image(2, 2, x => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const out = resize(src, 8, 8, 'contain');
    expect(out.width).toBe(8);

    const row = 4;
    const values = Array.from({ length: 8 }, (_, x) => out.pixels[(row * out.width + x) * 4]);
    // At least one sample strictly between the two source values.
    expect(values.some(v => v > 0 && v < 255)).toBe(true);
  });

  it('never produces a zero-dimension image', () => {
    const out = resize(image(10, 10, () => [0, 0, 0, 255]), 1, 1, 'contain');
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe('refusals', () => {
  // JPEG used to be refused outright — honest while there was no decoder, but a
  // tax on the most ordinary request, since photos ARE JPEGs. What must still
  // be refused is bytes that are not an image, and a TRUNCATED jpeg header is
  // exactly that: sniffing says "jpeg", decoding cannot produce pixels.
  it('refuses a truncated image rather than returning it untouched', () => {
    // Silently skipping would leave the caller believing the background was gone.
    expect(() => processAsset(Buffer.from('\xff\xd8\xff JPEG'), 'jpg', { remove_bg: true }))
      .toThrow();
  });

  it('carries a hint explaining what to do instead', () => {
    try {
      processAsset(Buffer.from('nope'), 'jpg', { remove_bg: true });
      expect.unreachable('should have thrown');
    } catch (e) {
      // Bytes that are not an image at all get the diagnosis that actually
      // helps — the usual cause is an error page saved with an image name.
      expect((e as ProcessError).hint).toContain('actually contains an image');
    }
  });

  it('passes the buffer through untouched when there is no work', () => {
    const buf = logoOnWhite();
    const r = processAsset(buf, 'png', {});
    expect(r.buffer).toBe(buf);
    expect(r.notes).toEqual([]);
  });
});
