import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GifStream, changedRect, fileSink, type ByteSink } from './gif-stream';

// ── A small GIF decoder, so these tests check what a viewer SEES ─────────────
interface Decoded { frames: Uint8ClampedArray[]; delaysCs: number[]; rects: number[][] }

function lzwDecode(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode, eoi = clear + 1;
  let dict: number[][] = [], size = minCode + 1, prev: number[] | null = null, op = 0;
  const reset = (): void => { dict = Array.from({ length: eoi + 1 }, (_, i) => [i]); size = minCode + 1; prev = null; };
  reset();
  for (let bit = 0; bit + size <= data.length * 8;) {
    let code = 0;
    for (let i = 0; i < size; i++) code |= ((data[(bit + i) >> 3] >> ((bit + i) & 7)) & 1) << i;
    bit += size;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    const entry: number[] = code < dict.length ? dict[code] : prev ? [...prev, prev[0]] : [];
    for (const v of entry) if (op < count) out[op++] = v;
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

function decode(buf: Buffer): Decoded {
  const W = buf.readUInt16LE(6), H = buf.readUInt16LE(8);
  const canvas = new Uint8ClampedArray(W * H * 4);
  const res: Decoded = { frames: [], delaysCs: [], rects: [] };
  let p = 13, delay = 0, transparent = -1, disposal = 0;
  let last: { x: number; y: number; w: number; h: number; disposal: number } | null = null;
  while (p < buf.length && buf[p] !== 0x3b) {
    if (buf[p] === 0x21) {
      if (buf[p + 1] === 0xf9) {
        disposal = (buf[p + 3] >> 2) & 7;
        delay = buf.readUInt16LE(p + 4);
        transparent = buf[p + 3] & 1 ? buf[p + 6] : -1;
      }
      p += 2;
      while (buf[p] !== 0) p += buf[p] + 1;
      p++;
      continue;
    }
    const x = buf.readUInt16LE(p + 1), y = buf.readUInt16LE(p + 3), w = buf.readUInt16LE(p + 5), h = buf.readUInt16LE(p + 7);
    const table = buf.subarray(p + 10, p + 10 + 3 * (1 << ((buf[p + 9] & 7) + 1)));
    p += 10 + table.length;
    const minCode = buf[p++];
    const chunks: Buffer[] = [];
    while (buf[p] !== 0) { chunks.push(buf.subarray(p + 1, p + 1 + buf[p])); p += buf[p] + 1; }
    p++;
    if (last?.disposal === 2) {
      for (let yy = last.y; yy < last.y + last.h; yy++) canvas.fill(0, (yy * W + last.x) * 4, (yy * W + last.x + last.w) * 4);
    }
    const idx = lzwDecode(Buffer.concat(chunks), minCode, w * h);
    for (let i = 0; i < w * h; i++) {
      if (idx[i] === transparent) continue;
      const o = ((y + Math.floor(i / w)) * W + x + (i % w)) * 4;
      canvas.set([table[idx[i] * 3], table[idx[i] * 3 + 1], table[idx[i] * 3 + 2], 255], o);
    }
    res.frames.push(canvas.slice());
    res.delaysCs.push(delay);
    res.rects.push([x, y, w, h]);
    last = { x, y, w, h, disposal };
  }
  return res;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const W = 40, H = 30;
const paint = (fn: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray => {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set(fn(x, y), (y * W + x) * 4);
  return px;
};
const cream = (): Uint8ClampedArray => paint(() => [244, 239, 230, 255]);
const withBox = (bx: number, by: number): Uint8ClampedArray =>
  paint((x, y) => (x >= bx && x < bx + 4 && y >= by && y < by + 3 ? [47, 91, 234, 255] : [244, 239, 230, 255]));

const memory = (): ByteSink & { buffer(): Buffer } => {
  const parts: Buffer[] = [];
  return { write: (c): void => { parts.push(Buffer.from(c)); }, close: (): void => undefined, buffer: () => Buffer.concat(parts) };
};
const encode = (frames: Uint8ClampedArray[], ms = 100): { gif: Decoded; stats: ReturnType<GifStream['finish']> } => {
  const sink = memory();
  const s = new GifStream(sink, { width: W, height: H });
  for (const f of frames) s.add(f, ms);
  const stats = s.finish();
  return { gif: decode(sink.buffer()), stats };
};

// ── Tests ───────────────────────────────────────────────────────────────────
describe('GifStream', () => {
  it('decodes back to exactly the frames it was given', () => {
    const src = [cream(), withBox(2, 2), withBox(20, 10)];
    const { gif } = encode(src);
    expect(gif.frames).toHaveLength(3);
    gif.frames.forEach((f, i) => expect(Buffer.from(f).equals(Buffer.from(src[i]))).toBe(true));
  });

  it('merges identical frames into one image with their summed delay', () => {
    const { gif, stats } = encode([cream(), cream(), cream(), withBox(5, 5)]);
    expect(stats.frames_in).toBe(4);
    expect(stats.images_written).toBe(2);
    expect(gif.delaysCs).toEqual([30, 10]);
  });

  it('writes only the rectangle that changed', () => {
    const { gif } = encode([cream(), withBox(12, 7)]);
    expect(gif.rects[0]).toEqual([0, 0, W, H]);
    expect(gif.rects[1]).toEqual([12, 7, 4, 3]);
  });

  it('repaints the whole canvas after a frame with transparency', () => {
    const holey = paint((x) => (x < 20 ? [244, 239, 230, 255] : [0, 0, 0, 0]));
    const { gif } = encode([holey, cream(), withBox(1, 1)]);
    expect(gif.rects[1]).toEqual([0, 0, W, H]);   // follows a disposed-to-background image
    expect(gif.rects[2]).toEqual([1, 1, 4, 3]);   // opaque again, so patching resumes
    expect(gif.frames[0][(0 * W + 30) * 4 + 3]).toBe(0);
    expect(Buffer.from(gif.frames[2]).equals(Buffer.from(withBox(1, 1)))).toBe(true);
  });

  it('keeps the total length exact when a frame is not a whole number of centiseconds', () => {
    // 12fps for 3s: 36 frames of 83.33ms. Rounding each alone plays 2.88s.
    const frames = Array.from({ length: 36 }, (_, i) => withBox(i, 0));
    const { gif } = encode(frames, 1000 / 12);
    expect(gif.delaysCs.reduce((a, b) => a + b, 0)).toBe(300);
  });

  it('refuses a wrong-sized frame and an empty stream', () => {
    const s = new GifStream(memory(), { width: W, height: H });
    expect(() => s.add(new Uint8ClampedArray(8), 100)).toThrow(/expected 40×30×4/);
    expect(() => s.finish()).toThrow(/no frames/);
  });
});

describe('changedRect', () => {
  it('is null for identical frames and tight around a single pixel', () => {
    expect(changedRect(cream(), cream(), W, H)).toBeNull();
    const one = cream();
    one.set([0, 0, 0, 255], (29 * W + 39) * 4);
    expect(changedRect(cream(), one, W, H)).toEqual({ x: 39, y: 29, width: 1, height: 1 });
  });
});

describe('fileSink', () => {
  it('exposes the file only once it is complete, and abort leaves nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-gifsink-'));
    try {
      const done = path.join(dir, 'a.gif');
      const sink = fileSink(done);
      sink.write(Buffer.from('GIF89a'));
      expect(fs.existsSync(done)).toBe(false);
      sink.close();
      expect(fs.readFileSync(done, 'ascii')).toBe('GIF89a');

      const gone = fileSink(path.join(dir, 'b.gif'));
      gone.write(Buffer.from('x'));
      gone.abort();
      expect(fs.readdirSync(dir)).toEqual(['a.gif']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
