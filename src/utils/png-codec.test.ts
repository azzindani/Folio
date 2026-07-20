import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { decodePNG, encodePNG, isPNG, crc32, PngError, type RasterImage } from './png-codec';

function solid(width: number, height: number, rgba: [number, number, number, number]): RasterImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = rgba[0];
    pixels[i * 4 + 1] = rgba[1];
    pixels[i * 4 + 2] = rgba[2];
    pixels[i * 4 + 3] = rgba[3];
  }
  return { width, height, pixels };
}

describe('crc32', () => {
  it('matches the known checksum for "IEND"', () => {
    // The canonical empty IEND chunk CRC — a fixed value in every PNG ever written.
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xae426082);
  });
});

describe('isPNG', () => {
  it('accepts a real PNG and rejects other bytes', () => {
    expect(isPNG(encodePNG(solid(2, 2, [0, 0, 0, 255])))).toBe(true);
    expect(isPNG(Buffer.from('not a png'))).toBe(false);
    expect(isPNG(Buffer.alloc(0))).toBe(false);
  });
});

describe('round trip', () => {
  it('preserves a solid colour exactly', () => {
    const src = solid(4, 3, [210, 98, 42, 255]);
    const out = decodePNG(encodePNG(src));
    expect(out.width).toBe(4);
    expect(out.height).toBe(3);
    expect([...out.pixels]).toEqual([...src.pixels]);
  });

  it('preserves alpha, including fully transparent pixels', () => {
    // This is the case background removal depends on — a lost alpha channel
    // would silently turn every cut-out back into a white rectangle.
    const src = solid(3, 3, [0, 0, 0, 0]);
    src.pixels[0] = 255; src.pixels[3] = 255; // one opaque red pixel
    const out = decodePNG(encodePNG(src));
    expect(out.pixels[3]).toBe(255);
    expect(out.pixels[7]).toBe(0);
  });

  it('preserves a gradient across rows, exercising the Paeth filter', () => {
    const w = 16, h = 16;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = x * 16; pixels[i + 1] = y * 16; pixels[i + 2] = 128; pixels[i + 3] = 255;
      }
    }
    const out = decodePNG(encodePNG({ width: w, height: h, pixels }));
    expect([...out.pixels]).toEqual([...pixels]);
  });

  it('handles a single-pixel image', () => {
    const out = decodePNG(encodePNG(solid(1, 1, [1, 2, 3, 4])));
    expect([...out.pixels]).toEqual([1, 2, 3, 4]);
  });
});

describe('decoding real resvg output', () => {
  // The codec exists to read what this engine actually produces. A synthetic
  // round trip only proves it agrees with itself.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
    '<rect width="40" height="40" fill="#FAF7F2"/>' +
    '<circle cx="20" cy="20" r="12" fill="#D2622A"/></svg>';

  it('decodes a resvg PNG to the expected dimensions and colours', () => {
    const png = Buffer.from(new Resvg(svg, {}).render().asPng());
    const img = decodePNG(png);
    expect(img.width).toBe(40);
    expect(img.height).toBe(40);

    // Corner is the background; centre is the circle.
    const at = (x: number, y: number): number[] => {
      const i = (y * img.width + x) * 4;
      return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]];
    };
    expect(at(0, 0)).toEqual([0xfa, 0xf7, 0xf2, 255]);
    expect(at(20, 20)).toEqual([0xd2, 0x62, 0x2a, 255]);
  });

  it('survives a decode → encode → decode cycle without drift', () => {
    const png = Buffer.from(new Resvg(svg, {}).render().asPng());
    const once = decodePNG(png);
    const twice = decodePNG(encodePNG(once));
    expect([...twice.pixels]).toEqual([...once.pixels]);
  });
});

describe('refusals', () => {
  it('rejects a non-PNG buffer by signature', () => {
    expect(() => decodePNG(Buffer.from('GIF89a....'))).toThrow(PngError);
  });

  it('names the unsupported feature rather than guessing', () => {
    // 16-bit PNG: valid file, out of scope. A half-decode would look like success.
    const png = encodePNG(solid(2, 2, [0, 0, 0, 255]));
    png.writeUInt8(16, 8 + 8 + 8); // IHDR bit depth field
    expect(() => decodePNG(png)).toThrow(/bit depth 16/);
  });

  it('rejects interlaced PNG explicitly', () => {
    const png = encodePNG(solid(2, 2, [0, 0, 0, 255]));
    png.writeUInt8(1, 8 + 8 + 12); // IHDR interlace field
    expect(() => decodePNG(png)).toThrow(/nterlaced/);
  });

  it('rejects a pixel buffer whose length disagrees with its dimensions', () => {
    expect(() => encodePNG({ width: 4, height: 4, pixels: new Uint8ClampedArray(8) })).toThrow(PngError);
  });

  it('reports truncation instead of returning partial pixels', () => {
    const png = encodePNG(solid(8, 8, [1, 2, 3, 255]));
    expect(() => decodePNG(png.subarray(0, 30))).toThrow(PngError);
  });
});
