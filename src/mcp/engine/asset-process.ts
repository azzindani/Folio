/**
 * Optional pixel processing applied to an asset as it is ingested.
 *
 * This is what makes background removal reachable from MCP. It rides on the
 * existing `asset_add` op as one extra field rather than a new op or tool —
 * the whole operation is still "put this image in the project", and a caller
 * who wants the cut-out version should not have to make two calls and manage
 * an intermediate file.
 *
 * Everything here is pure TypeScript over the PNG codec: no canvas, no sharp,
 * nothing that needs a native build in a `bun --smol` container.
 */

import { decodePNG, encodePNG, isPNG, PngError, type RasterImage } from '../../utils/png-codec';
import { removeBackgroundPixels, type BgRemoveStats } from '../../utils/bg-remove-core';

export interface ProcessSpec {
  remove_bg?: boolean | { tolerance?: number; feather?: number };
  fit?: { w?: number; h?: number; mode?: 'cover' | 'contain' };
}

export interface ProcessResult {
  buffer: Buffer;
  /** Human-readable notes for the tool's progress list. */
  notes: string[];
  /** Set when a background was removed, so callers can surface the coverage. */
  bgStats?: BgRemoveStats;
}

export class ProcessError extends Error {
  constructor(message: string, public hint: string) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** True when the spec asks for anything at all. */
export function hasWork(spec: ProcessSpec | undefined): spec is ProcessSpec {
  return !!spec && (spec.remove_bg !== undefined || spec.fit !== undefined);
}

/**
 * Resample to a target box.
 *
 * Bilinear, not nearest-neighbour: downscaling a photo by point-sampling
 * produces the aliased, crunchy look that reads as a broken image rather than a
 * smaller one. `contain` fits the whole image inside the box; `cover` fills the
 * box and crops the overflow, centred.
 */
export function resize(img: RasterImage, targetW: number, targetH: number, mode: 'cover' | 'contain'): RasterImage {
  const scale = mode === 'cover'
    ? Math.max(targetW / img.width, targetH / img.height)
    : Math.min(targetW / img.width, targetH / img.height);

  const drawW = Math.max(1, Math.round(img.width * scale));
  const drawH = Math.max(1, Math.round(img.height * scale));
  const outW = mode === 'cover' ? targetW : drawW;
  const outH = mode === 'cover' ? targetH : drawH;
  const offX = Math.round((drawW - outW) / 2);
  const offY = Math.round((drawH - outH) / 2);

  const out = new Uint8ClampedArray(outW * outH * 4);

  // Sample at pixel CENTRES: srcCoord = (out + 0.5) / scale - 0.5. Mapping
  // corner-to-corner instead (out / scale) lands every sample exactly on a
  // source pixel when scaling by a whole number — so an upscale produces hard
  // steps rather than a gradient — and shifts the whole image half a pixel
  // toward the origin at every other ratio.
  for (let y = 0; y < outH; y++) {
    const srcY = (y + offY + 0.5) / scale - 0.5;
    const y0 = Math.min(img.height - 1, Math.max(0, Math.floor(srcY)));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, srcY - y0));

    for (let x = 0; x < outW; x++) {
      const srcX = (x + offX + 0.5) / scale - 0.5;
      const x0 = Math.min(img.width - 1, Math.max(0, Math.floor(srcX)));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, srcX - x0));

      const d = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = img.pixels[(y0 * img.width + x0) * 4 + c];
        const p10 = img.pixels[(y0 * img.width + x1) * 4 + c];
        const p01 = img.pixels[(y1 * img.width + x0) * 4 + c];
        const p11 = img.pixels[(y1 * img.width + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        out[d + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }

  return { width: outW, height: outH, pixels: out };
}

/**
 * Apply a ProcessSpec to raw asset bytes, returning new bytes.
 *
 * PNG only, and it says so rather than guessing: JPEG and WebP decoding are a
 * different order of work, and quietly returning the original file would leave
 * the caller believing a background had been removed when it had not.
 */
export function processAsset(buf: Buffer, ext: string, spec: ProcessSpec): ProcessResult {
  if (!hasWork(spec)) return { buffer: buf, notes: [] };

  if (!isPNG(buf)) {
    throw new ProcessError(
      `Image processing needs a PNG; this asset is .${ext}.`,
      'Re-save the source as PNG and upload again. JPEG/WebP processing is not supported yet, ' +
      'and returning the file untouched would look like it had worked.',
    );
  }

  let img: RasterImage;
  try {
    img = decodePNG(buf);
  } catch (e) {
    if (e instanceof PngError) throw new ProcessError(e.message, 'Re-save the image as an 8-bit non-interlaced PNG.');
    throw e;
  }

  const notes: string[] = [];
  let bgStats: BgRemoveStats | undefined;

  if (spec.remove_bg) {
    const opts = typeof spec.remove_bg === 'object' ? spec.remove_bg : {};
    bgStats = removeBackgroundPixels(img.pixels, img.width, img.height, opts);
    const pct = Math.round(bgStats.removedFraction * 100);
    notes.push(`removed background (${pct}% of pixels, backdrop was rgb(${bgStats.background.join(',')}))`);
    // Two failure modes worth naming, because the caller cannot see the result:
    // nothing matched, or the fill ate the subject too.
    if (pct === 0) {
      notes.push('nothing matched the border colour — raise tolerance, or the image may already be cut out');
    } else if (pct > 95) {
      notes.push('almost the whole image was removed — the subject may match the backdrop; lower tolerance');
    }
  }

  if (spec.fit && (spec.fit.w || spec.fit.h)) {
    const mode = spec.fit.mode ?? 'contain';
    const w = spec.fit.w ?? img.width;
    const h = spec.fit.h ?? img.height;
    if (w <= 0 || h <= 0) throw new ProcessError('fit.w and fit.h must be positive.', 'Pass pixel dimensions, e.g. fit:{w:800,h:600}.');
    const before = `${img.width}×${img.height}`;
    img = resize(img, Math.round(w), Math.round(h), mode);
    notes.push(`resized ${before} → ${img.width}×${img.height} (${mode})`);
  }

  return { buffer: encodePNG(img), notes, bgStats };
}
