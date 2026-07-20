/**
 * Minimal PNG decoder/encoder in pure TypeScript.
 *
 * Server-side image processing needs pixels, and every obvious way to get them
 * is unavailable here: `canvas` and `sharp` are native modules (the deployment
 * is a 4g `bun --smol` container with no build step), and resvg rasterizes SVG
 * *out* rather than decoding rasters *in*. PNG is a well-specified format and
 * Node already ships the hard part — zlib — so decoding it directly costs a few
 * hundred lines and no dependency at all.
 *
 * Scope is deliberately narrow: 8-bit non-interlaced PNG, which is what
 * screenshots, exports and logo files actually are. Anything else returns a
 * clear error naming the unsupported feature rather than silently producing
 * wrong pixels — a half-decoded image is worse than a refusal, because it looks
 * like it worked.
 */

import { inflateSync, deflateSync } from 'zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major, length = width × height × 4. */
  pixels: Uint8ClampedArray;
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

interface Chunk {
  type: string;
  data: Buffer;
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/** Channels carried per pixel for each PNG color type. */
const CHANNELS: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // truecolor
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // truecolor + alpha
};

// ── CRC32 (PNG's chunk checksum) ────────────────────────────

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Chunk walking ───────────────────────────────────────────

function readChunks(buf: Buffer): Chunk[] {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngError('Not a PNG file (bad signature).');
  }

  const chunks: Chunk[] = [];
  let off = 8;

  while (off + 8 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    // A truncated file would otherwise read past the end and hand back garbage
    // pixels; stop at the last chunk that is actually complete.
    if (dataEnd + 4 > buf.length) break;

    chunks.push({ type, data: buf.subarray(dataStart, dataEnd) });
    off = dataEnd + 4; // skip the trailing CRC
    if (type === 'IEND') break;
  }

  return chunks;
}

function readHeader(chunks: Chunk[]): Header {
  const ihdr = chunks.find(c => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new PngError('PNG has no IHDR chunk.');

  const header: Header = {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data.readUInt8(8),
    colorType: ihdr.data.readUInt8(9),
    interlace: ihdr.data.readUInt8(12),
  };

  if (header.width <= 0 || header.height <= 0) throw new PngError('PNG has zero dimensions.');
  if (header.bitDepth !== 8) {
    throw new PngError(`Unsupported PNG bit depth ${header.bitDepth} (only 8-bit is supported). Re-save the image as 8-bit.`);
  }
  if (header.interlace !== 0) {
    throw new PngError('Interlaced PNG is not supported. Re-save without interlacing.');
  }
  if (CHANNELS[header.colorType] === undefined) {
    throw new PngError(`Unsupported PNG color type ${header.colorType}.`);
  }

  return header;
}

// ── Scanline unfiltering ────────────────────────────────────

/**
 * Reverse the per-scanline filter PNG applies before compression.
 *
 * Each row is prefixed with a filter byte and encoded as a delta against its
 * left neighbour (`a`), the row above (`b`), and the pixel up-left (`c`). The
 * filters must be undone in order, because every row after the first is defined
 * relative to the already-reconstructed row above it.
 */
function unfilter(raw: Buffer, header: Header, bpp: number): Buffer {
  const stride = header.width * bpp;
  const out = Buffer.alloc(stride * header.height);

  let pos = 0;
  for (let y = 0; y < header.height; y++) {
    if (pos >= raw.length) throw new PngError('PNG data ended early (truncated image).');
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x] ?? 0;
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;

      let value: number;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: throw new PngError(`Unknown PNG filter type ${filter} on row ${y}.`);
      }
      out[rowStart + x] = value & 0xff;
    }
    pos += stride;
  }

  return out;
}

/** PNG's Paeth predictor: pick whichever neighbour the gradient points at. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// ── Expansion to RGBA ───────────────────────────────────────

function toRGBA(data: Buffer, header: Header, palette: Buffer | null, alphaTable: Buffer | null): Uint8ClampedArray {
  const { width, height, colorType } = header;
  const px = new Uint8ClampedArray(width * height * 4);
  const src = CHANNELS[colorType];

  for (let i = 0, s = 0, d = 0; i < width * height; i++, s += src, d += 4) {
    switch (colorType) {
      case 0: // grayscale
        px[d] = px[d + 1] = px[d + 2] = data[s];
        px[d + 3] = 255;
        break;
      case 2: // RGB
        px[d] = data[s]; px[d + 1] = data[s + 1]; px[d + 2] = data[s + 2];
        px[d + 3] = 255;
        break;
      case 3: { // palette index
        if (!palette) throw new PngError('Indexed PNG is missing its PLTE palette.');
        const idx = data[s] * 3;
        px[d] = palette[idx]; px[d + 1] = palette[idx + 1]; px[d + 2] = palette[idx + 2];
        // tRNS is optional and may cover only the first N palette entries.
        px[d + 3] = alphaTable && data[s] < alphaTable.length ? alphaTable[data[s]] : 255;
        break;
      }
      case 4: // grayscale + alpha
        px[d] = px[d + 1] = px[d + 2] = data[s];
        px[d + 3] = data[s + 1];
        break;
      default: // 6 — RGBA
        px[d] = data[s]; px[d + 1] = data[s + 1]; px[d + 2] = data[s + 2]; px[d + 3] = data[s + 3];
    }
  }

  return px;
}

/** Decode an 8-bit non-interlaced PNG to RGBA pixels. Throws PngError on anything else. */
export function decodePNG(buf: Buffer): RasterImage {
  const chunks = readChunks(buf);
  const header = readHeader(chunks);

  const idat = chunks.filter(c => c.type === 'IDAT').map(c => c.data);
  if (idat.length === 0) throw new PngError('PNG has no image data (no IDAT chunk).');

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (e) {
    throw new PngError(`PNG image data could not be decompressed: ${(e as Error).message}`);
  }

  const bpp = CHANNELS[header.colorType];
  const unfiltered = unfilter(raw, header, bpp);
  const palette = chunks.find(c => c.type === 'PLTE')?.data ?? null;
  const alphaTable = chunks.find(c => c.type === 'tRNS')?.data ?? null;

  return {
    width: header.width,
    height: header.height,
    pixels: toRGBA(unfiltered, header, palette, alphaTable),
  };
}

// ── Encoding ────────────────────────────────────────────────

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode RGBA pixels as an 8-bit truecolor-with-alpha PNG.
 *
 * Rows are written with the Paeth filter rather than filter 0. Flat colour and
 * soft gradients — most of what this engine produces — compress far better once
 * each byte is a delta against its neighbours, and a cut-out asset that has to
 * survive an 8 MiB upload cap is worth the few lines.
 */
export function encodePNG(img: RasterImage): Buffer {
  const { width, height, pixels } = img;
  if (pixels.length !== width * height * 4) {
    throw new PngError(`Pixel buffer is ${pixels.length} bytes, expected ${width * height * 4}.`);
  }

  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const outStart = y * (stride + 1);
    raw[outStart] = 4; // Paeth

    for (let x = 0; x < stride; x++) {
      const value = pixels[rowStart + x];
      const a = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const b = y > 0 ? pixels[rowStart - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[rowStart - stride + x - bpp] : 0;
      raw[outStart + 1 + x] = (value - paeth(a, b, c)) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression: deflate
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // non-interlaced

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when a buffer starts with the PNG signature. */
export function isPNG(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(SIGNATURE);
}
