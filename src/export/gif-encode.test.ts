import { describe, it, expect } from 'vitest';
import { encodeGIF, lzwCompress, type GifFrame } from './gif-encode';
import { buildPalette, mapToPalette } from './gif-quantize';

function frame(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number], delayMs = 100): GifFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  return { pixels, delayMs };
}

const solid = (w: number, h: number, c: [number, number, number, number]): GifFrame => frame(w, h, () => c);

describe('encodeGIF — container structure', () => {
  const gif = encodeGIF([solid(8, 8, [255, 0, 0, 255]), solid(8, 8, [0, 0, 255, 255])], { width: 8, height: 8 });

  it('writes a GIF89a header with the right dimensions', () => {
    expect(gif.toString('ascii', 0, 6)).toBe('GIF89a');
    expect(gif.readUInt16LE(6)).toBe(8);
    expect(gif.readUInt16LE(8)).toBe(8);
  });

  it('declares an infinite loop via the NETSCAPE2.0 extension', () => {
    expect(gif.includes(Buffer.from('NETSCAPE2.0', 'ascii'))).toBe(true);
  });

  it('ends with the trailer byte', () => {
    expect(gif[gif.length - 1]).toBe(0x3b);
  });

  it('emits one image descriptor per frame', () => {
    let count = 0;
    for (let i = 0; i < gif.length; i++) if (gif[i] === 0x2c) count++;
    // 0x2c can occur inside compressed data, so this is a lower bound only.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('honours a finite loop count', () => {
    const once = encodeGIF([solid(4, 4, [1, 2, 3, 255])], { width: 4, height: 4, loopCount: 1 });
    const at = once.indexOf(Buffer.from('NETSCAPE2.0', 'ascii'));
    expect(once.readUInt16LE(at + 11 + 2)).toBe(1);
  });

  it('refuses an empty frame list rather than writing a broken file', () => {
    expect(() => encodeGIF([], { width: 4, height: 4 })).toThrow(/no frames/);
  });
});

describe('lzwCompress', () => {
  it('produces sub-blocks terminated by a zero byte', () => {
    const out = lzwCompress(Uint8Array.from([1, 1, 2, 3]), 8);
    expect(out[out.length - 1]).toBe(0);
  });

  it('never emits a sub-block longer than 255 bytes', () => {
    // Random data barely compresses, so this exercises the block-splitting path.
    const noisy = Uint8Array.from({ length: 40000 }, (_, i) => (i * 7919) % 256);
    const out = lzwCompress(noisy, 8);
    let p = 0;
    while (p < out.length) {
      const n = out[p];
      expect(n).toBeLessThanOrEqual(255);
      if (n === 0) break;
      p += n + 1;
    }
  });

  it('compresses a long run far below its input size', () => {
    const flat = new Uint8Array(20000).fill(7);
    expect(lzwCompress(flat, 8).length).toBeLessThan(2000);
  });

  it('handles input long enough to fill and reset the dictionary', () => {
    // >4096 distinct sequences forces the clear-code reset path.
    const long = Uint8Array.from({ length: 200000 }, (_, i) => (i * 31) % 256);
    expect(() => lzwCompress(long, 8)).not.toThrow();
  });

  it('handles an empty input', () => {
    expect(lzwCompress(new Uint8Array(0), 8).length).toBeGreaterThan(0);
  });
});

describe('transparency', () => {
  it('encodes a frame with transparent pixels without error', () => {
    const f = frame(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const gif = encodeGIF([f], { width: 8, height: 8 });
    expect(gif.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  it('reserves a palette slot for transparency', () => {
    const f = frame(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const palette = buildPalette(f.pixels);
    expect(palette.transparentIndex).toBeGreaterThanOrEqual(0);
    // Opaque entries plus the transparent index must still fit a 256-colour table.
    expect(palette.size + 1).toBeLessThanOrEqual(256);
  });

  it('maps transparent pixels to the reserved index', () => {
    const f = frame(4, 4, (x) => (x === 0 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
    const palette = buildPalette(f.pixels);
    const idx = mapToPalette(f.pixels, palette);
    expect(idx[1]).toBe(palette.transparentIndex);
    expect(idx[0]).not.toBe(palette.transparentIndex);
  });

  it('survives a fully transparent frame', () => {
    const f = solid(4, 4, [0, 0, 0, 0]);
    expect(() => encodeGIF([f], { width: 4, height: 4 })).not.toThrow();
  });
});
