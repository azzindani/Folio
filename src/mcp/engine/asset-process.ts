/**
 * Pixel processing applied to an asset as it is ingested, or to an existing
 * asset via `asset_process`.
 *
 * This is the Photoshop layer of the asset pipeline: background removal,
 * resize, crop, flip/rotate, trim/pad, rounded corners, tonal and colour
 * adjustments, blur/sharpen/vignette/grain. It rides on the existing
 * `asset_add` op as one `process` field — the whole operation is still "put
 * this image in the project" — and `asset_process` reuses it on a file that
 * is already stored.
 *
 * Everything here is pure TypeScript over the PNG codec: no canvas, no sharp,
 * nothing that needs a native build in a `bun --smol` container.
 */

import { decodePNG, encodePNG, isPNG, PngError, type RasterImage } from '../../utils/png-codec';
import { removeBackgroundPixels, type BgRemoveStats } from '../../utils/bg-remove-core';
import { adjust, hasAdjust, hexToRgb, type AdjustSpec } from '../../utils/image-adjust';
import { crop, cropToAspect, parseAspect, flip, rotate90, trim, pad, roundCorners, flatten, type CropSpec } from '../../utils/image-geometry';
import { gaussianBlur, sharpen, vignette, grain } from '../../utils/image-filters';

export interface ProcessSpec {
  remove_bg?: boolean | { tolerance?: number; feather?: number };
  /** Crop first: pixel box, or an aspect ratio like "16:9" / "1:1" with an anchor. */
  crop?: CropSpec;
  /** Cut transparent margins; number = margin to leave, true = 0. */
  trim?: boolean | number;
  rotate?: number;
  flip?: 'h' | 'v' | 'hv';
  fit?: { w?: number; h?: number; mode?: 'cover' | 'contain' };
  /** Photoshop "Adjustments": brightness, contrast, exposure, gamma, levels, saturation, hue, invert, sepia, duotone, tint, posterize, threshold, opacity. */
  adjust?: AdjustSpec;
  blur?: number;
  sharpen?: number | { amount?: number; radius?: number };
  vignette?: number | { strength?: number; softness?: number; color?: string };
  grain?: number;
  /** Rounded-corner clip, px. */
  round?: number;
  /** Border in px (or per side) filled with a hex colour, or transparent when omitted. */
  pad?: number | { top?: number; right?: number; bottom?: number; left?: number; color?: string };
  /** Flatten transparency onto a solid hex colour. */
  flatten?: string;
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

export const PROCESS_KEYS: Array<keyof ProcessSpec> = [
  'remove_bg', 'crop', 'trim', 'rotate', 'flip', 'fit', 'adjust', 'blur', 'sharpen', 'vignette', 'grain', 'round', 'pad', 'flatten',
];

/** True when the spec asks for anything at all. */
export function hasWork(spec: ProcessSpec | undefined): spec is ProcessSpec {
  if (!spec) return false;
  return PROCESS_KEYS.some(k => spec[k] !== undefined && (k !== 'adjust' || hasAdjust(spec.adjust)));
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

const dims = (i: RasterImage): string => `${i.width}×${i.height}`;

/** Run every step of a ProcessSpec on decoded pixels, in pipeline order. */
export function processImage(img: RasterImage, spec: ProcessSpec): { img: RasterImage; notes: string[]; bgStats?: BgRemoveStats } {
  const notes: string[] = [];
  let bgStats: BgRemoveStats | undefined;

  // 1. Geometry that reduces the image — cheapest first, so later passes touch fewer pixels.
  if (spec.crop) {
    const c = spec.crop;
    const before = dims(img);
    if (c.aspect) {
      const ratio = parseAspect(c.aspect);
      if (!ratio) throw new ProcessError(`crop.aspect "${c.aspect}" is not a ratio.`, 'Use "16:9", "1:1", "4:5" …');
      img = cropToAspect(img, ratio, c.anchor);
    } else if (typeof c.w === 'number' && typeof c.h === 'number') {
      img = crop(img, c.x ?? 0, c.y ?? 0, c.w, c.h);
    } else {
      throw new ProcessError('crop needs {x,y,w,h} or {aspect}.', 'Example: crop:{aspect:"1:1", anchor:"top"} or crop:{x:0,y:0,w:800,h:600}.');
    }
    if (img.width === 0 || img.height === 0) throw new ProcessError('crop box lies outside the image.', 'Check x/y/w/h against the asset\'s width/height from asset_list.');
    notes.push(`cropped ${before} → ${dims(img)}`);
  }

  if (spec.remove_bg) {
    const opts = typeof spec.remove_bg === 'object' ? spec.remove_bg : {};
    bgStats = removeBackgroundPixels(img.pixels, img.width, img.height, opts);
    const pct = Math.round(bgStats.removedFraction * 100);
    notes.push(`removed background (${pct}% of pixels, backdrop was rgb(${bgStats.background.join(',')}))`);
    if (pct === 0) notes.push('nothing matched the border colour — raise tolerance, or the image may already be cut out');
    else if (pct > 95) notes.push('almost the whole image was removed — the subject may match the backdrop; lower tolerance');
  }

  if (spec.trim !== undefined && spec.trim !== false) {
    const before = dims(img);
    img = trim(img, typeof spec.trim === 'number' ? spec.trim : 0);
    notes.push(`trimmed ${before} → ${dims(img)}`);
  }

  if (spec.rotate) { img = rotate90(img, spec.rotate); notes.push(`rotated ${Math.round(spec.rotate / 90) * 90}°`); }
  if (spec.flip) { img = flip(img, spec.flip.includes('h'), spec.flip.includes('v')); notes.push(`flipped ${spec.flip}`); }

  if (spec.fit && (spec.fit.w || spec.fit.h)) {
    const mode = spec.fit.mode ?? 'contain';
    const w = spec.fit.w ?? img.width;
    const h = spec.fit.h ?? img.height;
    if (w <= 0 || h <= 0) throw new ProcessError('fit.w and fit.h must be positive.', 'Pass pixel dimensions, e.g. fit:{w:800,h:600}.');
    const before = dims(img);
    img = resize(img, Math.round(w), Math.round(h), mode);
    notes.push(`resized ${before} → ${dims(img)} (${mode})`);
  }

  // 2. Tone and colour.
  if (hasAdjust(spec.adjust)) notes.push(...adjust(img, spec.adjust));

  // 3. Filters.
  if (spec.blur && spec.blur > 0) { img = gaussianBlur(img, spec.blur); notes.push(`blur ${spec.blur}px`); }
  if (spec.sharpen) {
    const s = typeof spec.sharpen === 'number' ? { amount: spec.sharpen } : spec.sharpen;
    img = sharpen(img, s.amount ?? 1, s.radius ?? 1); notes.push(`sharpen ${s.amount ?? 1}`);
  }
  if (spec.vignette) {
    const v = typeof spec.vignette === 'number' ? { strength: spec.vignette } : spec.vignette;
    img = vignette(img, v.strength ?? 0.5, v.softness ?? 0.6, v.color ? hexToRgb(v.color) : undefined); notes.push(`vignette ${v.strength ?? 0.5}`);
  }
  if (spec.grain && spec.grain > 0) { img = grain(img, spec.grain); notes.push(`grain ${spec.grain}`); }

  // 4. Framing that grows the image last.
  if (spec.round && spec.round > 0) { img = roundCorners(img, spec.round); notes.push(`rounded corners ${spec.round}px`); }
  if (spec.pad !== undefined) {
    const p = typeof spec.pad === 'number' ? { px: spec.pad } : spec.pad;
    const color = typeof p === 'object' && 'color' in p && p.color ? [...hexToRgb(p.color), 255] as [number, number, number, number] : undefined;
    const before = dims(img);
    img = pad(img, 'px' in p ? p.px : p, color);
    notes.push(`padded ${before} → ${dims(img)}`);
  }
  if (spec.flatten) { img = flatten(img, hexToRgb(spec.flatten)); notes.push(`flattened onto ${spec.flatten}`); }

  return { img, notes, bgStats };
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

  const r = processImage(img, spec);
  return { buffer: encodePNG(r.img), notes: r.notes, bgStats: r.bgStats };
}
