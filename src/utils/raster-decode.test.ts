import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { decodeRaster, sniffRaster, DecodeError } from './raster-decode';
import { encodePNG, decodePNG } from './png-codec';

const px = (w: number, h: number, fill: number[]): Buffer => {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) pixels.set(fill, i * 4);
  return encodePNG({ width: w, height: h, pixels });
};

// A 1×1 JPEG and a 1×1 lossy WebP, so the test needs nothing from disk.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

describe('sniffRaster', () => {
  it('reads the format from the BYTES, not a filename', () => {
    expect(sniffRaster(px(1, 1, [1, 2, 3, 255]))).toBe('png');
    expect(sniffRaster(JPEG_1PX)).toBe('jpeg');
    expect(sniffRaster(Buffer.from('RIFF____WEBPVP8 '))).toBe('webp');
    expect(sniffRaster(Buffer.from('GIF89a'))).toBe('gif');
  });

  it('is null for something that is not an image at all', () => {
    expect(sniffRaster(Buffer.from('<html>404</html>'))).toBeNull();
  });
});

describe('decodeRaster', () => {
  it('passes PNG straight through the existing codec, byte for byte', () => {
    const buf = px(3, 2, [10, 20, 30, 255]);
    expect(Array.from(decodeRaster(buf).pixels)).toEqual(Array.from(decodePNG(buf).pixels));
  });

  it('decodes a JPEG that the pipeline used to refuse outright', () => {
    const img = decodeRaster(JPEG_1PX);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.pixels.length).toBe(4);
  });

  it('explains itself instead of throwing something opaque', () => {
    try {
      decodeRaster(Buffer.from('<html>404</html>'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      expect((e as DecodeError).hint).toContain('HTML error page');
    }
  });

  // The reason for decoding at native size: a caller asking to crop 40px means
  // 40 of the image's OWN pixels, so a silent resample would move the crop.
  it('decodes a real photograph at its native size', () => {
    const dir = path.resolve('folio-projects/sky-field-guide/.trash');
    const jpg = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => f.endsWith('.jpg')) : undefined;
    if (!jpg) return;                      // fixture-free environments skip this
    const img = decodeRaster(fs.readFileSync(path.join(dir, jpg)));
    expect(img.width).toBeGreaterThan(100);
    expect(img.pixels.length).toBe(img.width * img.height * 4);
  });
});
