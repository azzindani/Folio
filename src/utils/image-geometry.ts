/**
 * Geometry operations on RGBA rasters — crop, flip, rotate by quarter turns,
 * trim transparent margins, pad, round corners. The Photoshop "Image" and
 * "Canvas Size" menus, minus anything that needs resampling (that lives in
 * asset-process.ts as `resize`).
 *
 * All functions return a NEW image; the input is never mutated, so a caller
 * can chain them on the same source without surprises.
 */

import type { RasterImage } from './png-codec';

export interface CropSpec {
  x?: number; y?: number; w?: number; h?: number;
  /** Named crop: keep this fraction of the image, anchored. */
  aspect?: string;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

function blank(width: number, height: number): RasterImage {
  return { width, height, pixels: new Uint8ClampedArray(Math.max(0, width * height * 4)) };
}

export function crop(img: RasterImage, x: number, y: number, w: number, h: number): RasterImage {
  const x0 = Math.max(0, Math.min(img.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height, Math.round(y)));
  const x1 = Math.max(x0, Math.min(img.width, Math.round(x + w)));
  const y1 = Math.max(y0, Math.min(img.height, Math.round(y + h)));
  const out = blank(x1 - x0, y1 - y0);
  for (let yy = y0; yy < y1; yy++) {
    const src = (yy * img.width + x0) * 4;
    out.pixels.set(img.pixels.subarray(src, src + (x1 - x0) * 4), (yy - y0) * out.width * 4);
  }
  return out;
}

/** Parse "16:9", "1:1", "4:5" → ratio, or null. */
export function parseAspect(s: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(s);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  return a > 0 && b > 0 ? a / b : null;
}

/** Crop to an aspect ratio, keeping as much as possible, anchored. */
export function cropToAspect(img: RasterImage, ratio: number, anchor: CropSpec['anchor'] = 'center'): RasterImage {
  const cur = img.width / img.height;
  let w = img.width, h = img.height;
  if (cur > ratio) w = Math.round(img.height * ratio); else h = Math.round(img.width / ratio);
  let x = Math.round((img.width - w) / 2), y = Math.round((img.height - h) / 2);
  if (anchor === 'left') x = 0; else if (anchor === 'right') x = img.width - w;
  if (anchor === 'top') y = 0; else if (anchor === 'bottom') y = img.height - h;
  return crop(img, x, y, w, h);
}

export function flip(img: RasterImage, horizontal: boolean, vertical: boolean): RasterImage {
  const out = blank(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const sy = vertical ? img.height - 1 - y : y;
    for (let x = 0; x < img.width; x++) {
      const sx = horizontal ? img.width - 1 - x : x;
      const s = (sy * img.width + sx) * 4, d = (y * img.width + x) * 4;
      out.pixels[d] = img.pixels[s]; out.pixels[d + 1] = img.pixels[s + 1];
      out.pixels[d + 2] = img.pixels[s + 2]; out.pixels[d + 3] = img.pixels[s + 3];
    }
  }
  return out;
}

/** Rotate by a multiple of 90°. Anything else is rounded to the nearest quarter turn. */
export function rotate90(img: RasterImage, degrees: number): RasterImage {
  const q = ((Math.round(degrees / 90) % 4) + 4) % 4;
  if (q === 0) return { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  if (q === 2) return flip(img, true, true);
  const out = blank(img.height, img.width);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      // q=1 → clockwise: (x,y) → (W'-1-y, x) where W' = old height
      const dx = q === 1 ? img.height - 1 - y : y;
      const dy = q === 1 ? x : img.width - 1 - x;
      const d = (dy * out.width + dx) * 4;
      out.pixels[d] = img.pixels[s]; out.pixels[d + 1] = img.pixels[s + 1];
      out.pixels[d + 2] = img.pixels[s + 2]; out.pixels[d + 3] = img.pixels[s + 3];
    }
  }
  return out;
}

/** Bounding box of pixels with alpha above `threshold`, or null if all transparent. */
export function opaqueBounds(img: RasterImage, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.pixels[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Trim transparent margins, leaving `margin` px around the content. */
export function trim(img: RasterImage, margin = 0): RasterImage {
  const b = opaqueBounds(img);
  if (!b) return { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const m = Math.max(0, Math.round(margin));
  return crop(img, b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m);
}

/** Add a border of `px` on every side (or per side), filled with a colour or transparent. */
export function pad(
  img: RasterImage,
  px: number | { top?: number; right?: number; bottom?: number; left?: number },
  fill?: [number, number, number, number],
): RasterImage {
  const p = typeof px === 'number' ? { top: px, right: px, bottom: px, left: px } : px;
  const t = Math.max(0, Math.round(p.top ?? 0)), r = Math.max(0, Math.round(p.right ?? 0));
  const b = Math.max(0, Math.round(p.bottom ?? 0)), l = Math.max(0, Math.round(p.left ?? 0));
  const out = blank(img.width + l + r, img.height + t + b);
  if (fill) {
    for (let i = 0; i < out.pixels.length; i += 4) {
      out.pixels[i] = fill[0]; out.pixels[i + 1] = fill[1]; out.pixels[i + 2] = fill[2]; out.pixels[i + 3] = fill[3];
    }
  }
  for (let y = 0; y < img.height; y++) {
    out.pixels.set(img.pixels.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + t) * out.width + l) * 4);
  }
  return out;
}

/** Clip to a rounded rectangle with anti-aliased corners; alpha outside → 0. */
export function roundCorners(img: RasterImage, radius: number): RasterImage {
  const r = Math.max(0, Math.min(radius, img.width / 2, img.height / 2));
  const out = { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  if (r === 0) return out;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      // Distance from the nearest corner circle centre, only inside corner squares.
      const cx = x < r ? r : x >= img.width - r ? img.width - r - 1 : -1;
      const cy = y < r ? r : y >= img.height - r ? img.height - r - 1 : -1;
      if (cx < 0 || cy < 0) continue;
      const d = Math.hypot(x + 0.5 - (cx + 0.5), y + 0.5 - (cy + 0.5));
      const cover = Math.max(0, Math.min(1, r - d + 0.5));
      const i = (y * img.width + x) * 4 + 3;
      out.pixels[i] = Math.round(out.pixels[i] * cover);
    }
  }
  return out;
}

/** Flatten transparency onto a solid colour (the "save without alpha" step). */
export function flatten(img: RasterImage, bg: [number, number, number]): RasterImage {
  const out = { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const p = out.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3] / 255;
    p[i] = Math.round(p[i] * a + bg[0] * (1 - a));
    p[i + 1] = Math.round(p[i + 1] * a + bg[1] * (1 - a));
    p[i + 2] = Math.round(p[i + 2] * a + bg[2] * (1 - a));
    p[i + 3] = 255;
  }
  return out;
}
