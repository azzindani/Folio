/**
 * GIF89a writer with LZW compression — pure TypeScript, no ffmpeg.
 *
 * The deployed container has neither ffmpeg nor Puppeteer, and adding a 300 MB
 * encoder plus a headless Chromium to a 4g `bun --smol` box so a logo can loop
 * is the wrong trade. GIF's compression is LZW over palette indices, which is
 * about a hundred lines, and the frames come from resvg — already a dependency.
 *
 * Animated SVG remains the better output wherever it renders (vector, kilobytes,
 * sharp at any size). GIF exists for the places that will not display an SVG at
 * all, which is most social feeds.
 */

import { buildPalette, mapToPalette, type Palette } from './gif-quantize';

export interface GifFrame {
  /** RGBA, row-major, width × height × 4. */
  pixels: Uint8ClampedArray;
  /** Frame delay in milliseconds. */
  delayMs: number;
}

export interface GifOptions {
  width: number;
  height: number;
  /** 0 = loop forever (the default and what a design loop wants). */
  loopCount?: number;
}

/** Growable byte sink — a GIF is written as one contiguous stream. */
class ByteWriter {
  private buf: Buffer;
  private len = 0;

  constructor(initial = 1 << 16) { this.buf = Buffer.alloc(initial); }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = Buffer.alloc(size);
    this.buf.copy(next, 0, 0, this.len);
    this.buf = next;
  }

  byte(v: number): void { this.ensure(1); this.buf[this.len++] = v & 0xff; }
  short(v: number): void { this.byte(v); this.byte(v >> 8); } // GIF is little-endian
  bytes(src: Uint8Array | Buffer): void {
    this.ensure(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.len++] = src[i];
  }
  ascii(s: string): void { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  toBuffer(): Buffer { return Buffer.from(this.buf.subarray(0, this.len)); }
}

/** Smallest power-of-two palette size GIF allows, and its log2 (the "colour resolution"). */
function paletteBits(size: number): number {
  let bits = 1;
  while ((1 << bits) < size && bits < 8) bits++;
  return bits;
}

/** Write a colour table padded out to the next power of two, as the format requires. */
function writeColorTable(w: ByteWriter, palette: Palette, bits: number): void {
  const entries = 1 << bits;
  for (let i = 0; i < entries; i++) {
    if (i < palette.size) {
      w.bytes(palette.rgb.subarray(i * 3, i * 3 + 3));
    } else {
      w.bytes(new Uint8Array([0, 0, 0]));
    }
  }
}

/**
 * LZW-compress palette indices into GIF's sub-block stream.
 *
 * The dictionary resets whenever it fills (code 4096), which is what keeps a
 * long animation from degrading: without the reset, codes grow to 12 bits and
 * never come back down, and later frames compress worse than earlier ones.
 */
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Buffer {
  const out = new ByteWriter(Math.max(1024, indices.length >> 1));
  const block: number[] = [];

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  // Dictionary keyed on (prefixCode << 8) | nextIndex, as a NUMBER. A frame is
  // millions of pixels; building a string key per pixel dominates the whole
  // export and turns a one-second encode into a minute of garbage collection.
  let dict = new Map<number, number>();

  let bitBuffer = 0;
  let bitCount = 0;

  const pushByte = (b: number): void => {
    block.push(b);
    if (block.length === 255) {
      out.byte(255);
      out.bytes(Uint8Array.from(block));
      block.length = 0;
    }
  };

  // Bit packing is least-significant-bit first — GIF's convention.
  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      pushByte(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);

  if (indices.length > 0) {
    let prefix = indices[0];

    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const existing = dict.get(key);
      if (existing !== undefined) {
        prefix = existing;
        continue;
      }

      emit(prefix);
      dict.set(key, nextCode++);

      if (nextCode > 4095) {
        // The dictionary is full. Resetting keeps later frames compressing as
        // well as the first; without it codes stay at 12 bits forever.
        emit(clearCode);
        dict = new Map<number, number>();
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      } else if (nextCode > (1 << codeSize) && codeSize < 12) {
        // Widen one code LATER than the symmetric rule would suggest.
        //
        // A decoder builds its table one entry behind the encoder: it can only
        // add an entry once it has seen the following code. Widening at
        // nextCode === (1 << codeSize) therefore desynchronises them — the
        // encoder starts writing n+1 bit codes while the decoder is still
        // reading n, and everything after that point is garbage. Verified
        // against a real decoder (Pillow): `>=` produces a file whose header
        // parses but whose pixel stream is truncated; `>` round-trips exactly.
        codeSize++;
      }

      prefix = k;
    }

    emit(prefix);
  }

  emit(eoiCode);

  if (bitCount > 0) pushByte(bitBuffer & 0xff);
  if (block.length > 0) {
    out.byte(block.length);
    out.bytes(Uint8Array.from(block));
  }
  out.byte(0); // block terminator

  return out.toBuffer();
}

/** Encode frames as an animated GIF89a. */
export function encodeGIF(frames: GifFrame[], opts: GifOptions): Buffer {
  if (frames.length === 0) throw new Error('encodeGIF: no frames given.');
  const { width, height } = opts;
  const w = new ByteWriter();

  w.ascii('GIF89a');
  w.short(width);
  w.short(height);
  // No global colour table: each frame carries its own, so a palette chosen for
  // one moment of the animation cannot wreck another. Costs a few hundred bytes
  // per frame and removes a whole class of colour-shift artefact.
  w.byte(0x70);  // colour resolution 8-bit, no GCT, no sort
  w.byte(0);     // background colour index
  w.byte(0);     // pixel aspect ratio: none

  // NETSCAPE2.0 application extension — the de-facto loop control.
  w.byte(0x21); w.byte(0xff); w.byte(11);
  w.ascii('NETSCAPE2.0');
  w.byte(3); w.byte(1);
  w.short(opts.loopCount ?? 0);
  w.byte(0);

  for (const frame of frames) {
    const palette = buildPalette(frame.pixels);
    const indices = mapToPalette(frame.pixels, palette);
    const tableSize = palette.transparentIndex >= 0 ? palette.size + 1 : palette.size;
    const bits = paletteBits(tableSize);

    // Graphic control extension: delay, and the transparent index if any.
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    const hasAlpha = palette.transparentIndex >= 0;
    // Disposal method 2 (restore to background) when transparent, so a moving
    // shape does not smear its previous position across the next frame.
    w.byte((hasAlpha ? 0x08 : 0x04) | (hasAlpha ? 0x01 : 0x00));
    w.short(Math.max(1, Math.round(frame.delayMs / 10))); // GIF counts in centiseconds
    w.byte(hasAlpha ? palette.transparentIndex : 0);
    w.byte(0);

    // Image descriptor — full-frame, with a local colour table.
    w.byte(0x2c);
    w.short(0); w.short(0);
    w.short(width); w.short(height);
    w.byte(0x80 | (bits - 1)); // local colour table present, size = 2^bits
    writeColorTable(w, palette, bits);

    const minCodeSize = Math.max(2, bits);
    w.byte(minCodeSize);
    w.bytes(lzwCompress(indices, minCodeSize));
  }

  w.byte(0x3b); // trailer
  return w.toBuffer();
}
