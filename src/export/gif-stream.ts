/**
 * Streaming GIF writer — frames go to disk as they are rendered.
 *
 * `encodeGIF` holds every frame as RGBA until the end, so the exporter had to
 * cap the frame count against a memory budget: a 30s scene at 1080×1350 got 32
 * frames and shipped at 1fps. Here only two frames are ever alive (the one on
 * screen and the one waiting), whatever the length.
 *
 * Two things keep long explainers small, both lossless:
 *  • A frame identical to the one before it is not written again — its delay is
 *    added to the previous image. A 30s piece is mostly holds.
 *  • An opaque frame is written as only the RECTANGLE that changed, left on top
 *    of the previous image (disposal 1). A card rising in one corner costs that
 *    corner, not the canvas. Frames with transparency are always written whole,
 *    because they are disposed to background and the next frame must repaint.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ByteWriter, writeGifHeader, writeGifImage, type FrameRect, type GifOptions } from './gif-encode';

/** Where encoded bytes go. */
export interface ByteSink { write(chunk: Uint8Array): void; close(): void }

export interface GifStreamStats {
  /** Frames handed to add(). */
  frames_in: number;
  /** Images actually encoded, after identical frames were merged. */
  images_written: number;
  bytes: number;
}

/** Alpha below this is transparent in the palette — must match gif-quantize. */
const ALPHA_CUTOFF = 128;

const asBuffer = (a: Uint8ClampedArray): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function isOpaque(px: Uint8ClampedArray): boolean {
  for (let p = 3; p < px.length; p += 4) if (px[p] < ALPHA_CUTOFF) return false;
  return true;
}

/** Bounding box of every pixel that differs between two frames, or null when none does. */
export function changedRect(prev: Uint8ClampedArray, next: Uint8ClampedArray, width: number, height: number): FrameRect | null {
  const A = asBuffer(prev), B = asBuffer(next);
  const row = width * 4;
  const rowDiffers = (y: number): boolean => A.compare(B, y * row, (y + 1) * row, y * row, (y + 1) * row) !== 0;
  const pxDiffers = (p: number): boolean =>
    A[p] !== B[p] || A[p + 1] !== B[p + 1] || A[p + 2] !== B[p + 2] || A[p + 3] !== B[p + 3];

  let top = 0;
  while (top < height && !rowDiffers(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && !rowDiffers(bottom)) bottom--;

  let left = width, right = -1;
  for (let y = top; y <= bottom; y++) {
    if (!rowDiffers(y)) continue;
    const o = y * row;
    for (let x = 0; x < left; x++) if (pxDiffers(o + x * 4)) { left = x; break; }
    for (let x = width - 1; x > right; x--) if (pxDiffers(o + x * 4)) { right = x; break; }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function crop(px: Uint8ClampedArray, width: number, r: FrameRect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const s = ((r.y + y) * width + r.x) * 4;
    out.set(px.subarray(s, s + r.width * 4), y * r.width * 4);
  }
  return out;
}

export class GifStream {
  private readonly w = new ByteWriter();
  private readonly full: FrameRect;
  private pending: { px: Uint8ClampedArray; ms: number } | null = null;
  /** What a decoder's canvas holds after the last written image. */
  private shown: Uint8ClampedArray | null = null;
  private mustRepaint = true;
  private elapsedMs = 0;
  private elapsedCs = 0;
  private stats: GifStreamStats = { frames_in: 0, images_written: 0, bytes: 0 };

  constructor(private readonly sink: ByteSink, private readonly opts: GifOptions) {
    this.full = { x: 0, y: 0, width: opts.width, height: opts.height };
    writeGifHeader(this.w, opts);
    this.flush();
  }

  /** Add one frame. The stream keeps the buffer, so pass a fresh one per call. */
  add(pixels: Uint8ClampedArray, delayMs: number): void {
    if (pixels.length !== this.opts.width * this.opts.height * 4) {
      throw new Error(`GifStream: frame is ${pixels.length} bytes, expected ${this.opts.width}×${this.opts.height}×4.`);
    }
    this.stats.frames_in++;
    if (this.pending && asBuffer(this.pending.px).equals(asBuffer(pixels))) {
      this.pending.ms += delayMs;
      return;
    }
    if (this.pending) this.emit(this.pending.px, this.pending.ms);
    this.pending = { px: pixels, ms: delayMs };
  }

  /** Write the last image and the trailer, close the sink, and report what was written. */
  finish(): GifStreamStats {
    if (!this.pending) throw new Error('GifStream: no frames given.');
    this.emit(this.pending.px, this.pending.ms);
    this.pending = null;
    this.w.byte(0x3b); // trailer
    this.flush();
    this.sink.close();
    return { ...this.stats };
  }

  private emit(px: Uint8ClampedArray, ms: number): void {
    const patch = !this.mustRepaint && this.shown !== null && isOpaque(px)
      ? changedRect(this.shown, px, this.opts.width, this.opts.height)
      : null;
    const rect = patch ?? this.full;
    const image = patch ? crop(px, this.opts.width, patch) : px;
    this.mustRepaint = writeGifImage(this.w, image, rect, this.centiseconds(ms));
    this.shown = px;
    this.stats.images_written++;
    this.flush();
  }

  /**
   * GIF delays are whole centiseconds, so 12fps (8.33cs) rounded per frame
   * plays 30s in 28.8s. Rounding the RUNNING total keeps the clip's length
   * exact. Never below 2cs: browsers treat 0–1cs as 10cs, which is slower.
   */
  private centiseconds(ms: number): number {
    const cs = Math.max(2, Math.round((this.elapsedMs + ms) / 10) - this.elapsedCs);
    this.elapsedMs += ms;
    this.elapsedCs += cs;
    return cs;
  }

  private flush(): void {
    const chunk = this.w.drain();
    if (chunk.length === 0) return;
    this.sink.write(chunk);
    this.stats.bytes += chunk.length;
  }
}

/** A file that only appears under its real name once it is complete. */
export function fileSink(finalPath: string): ByteSink & { abort(): void } {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const partial = `${finalPath}.partial`;
  const fd = fs.openSync(partial, 'w');
  let open = true;
  return {
    write(chunk: Uint8Array): void {
      let off = 0;
      while (off < chunk.length) off += fs.writeSync(fd, chunk, off, chunk.length - off);
    },
    close(): void {
      if (!open) return;
      open = false;
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(partial, finalPath);
    },
    abort(): void {
      if (open) { open = false; fs.closeSync(fd); }
      fs.rmSync(partial, { force: true });
    },
  };
}
