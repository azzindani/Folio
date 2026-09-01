/**
 * Convolution-style filters — the Photoshop "Filter" menu: gaussian blur,
 * unsharp mask, vignette, grain. Separable passes keep a 4K-wide image in
 * the tens of milliseconds; nothing here allocates more than two buffers.
 */

import type { RasterImage } from './png-codec';

function gaussianKernel(radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const sigma = r / 2;
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable gaussian blur on premultiplied colour, so transparent edges do not darken. */
export function gaussianBlur(img: RasterImage, radius: number): RasterImage {
  const r = Math.round(radius);
  if (r < 1) return { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const k = gaussianKernel(r);
  const { width: W, height: H } = img;
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < src.length; i += 4) {
    const a = img.pixels[i + 3] / 255;
    src[i] = img.pixels[i] * a; src[i + 1] = img.pixels[i + 1] * a; src[i + 2] = img.pixels[i + 2] * a; src[i + 3] = img.pixels[i + 3];
  }
  const tmp = new Float32Array(src.length);
  // Horizontal pass.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
    for (let j = -r; j <= r; j++) {
      const sx = Math.min(W - 1, Math.max(0, x + j));
      const s = (y * W + sx) * 4, w = k[j + r];
      r0 += src[s] * w; g0 += src[s + 1] * w; b0 += src[s + 2] * w; a0 += src[s + 3] * w;
    }
    const d = (y * W + x) * 4;
    tmp[d] = r0; tmp[d + 1] = g0; tmp[d + 2] = b0; tmp[d + 3] = a0;
  }
  // Vertical pass, un-premultiply on write.
  const out: RasterImage = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
    for (let j = -r; j <= r; j++) {
      const sy = Math.min(H - 1, Math.max(0, y + j));
      const s = (sy * W + x) * 4, w = k[j + r];
      r0 += tmp[s] * w; g0 += tmp[s + 1] * w; b0 += tmp[s + 2] * w; a0 += tmp[s + 3] * w;
    }
    const d = (y * W + x) * 4;
    const a = a0 / 255;
    out.pixels[d] = a > 0 ? Math.round(r0 / a) : 0;
    out.pixels[d + 1] = a > 0 ? Math.round(g0 / a) : 0;
    out.pixels[d + 2] = a > 0 ? Math.round(b0 / a) : 0;
    out.pixels[d + 3] = Math.round(a0);
  }
  return out;
}

/** Unsharp mask: original + amount × (original − blurred). amount 0…5, radius px. */
export function sharpen(img: RasterImage, amount = 1, radius = 1): RasterImage {
  const blurred = gaussianBlur(img, radius);
  const out: RasterImage = { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const k = Math.max(0, Math.min(5, amount));
  for (let i = 0; i < out.pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = img.pixels[i + c] + k * (img.pixels[i + c] - blurred.pixels[i + c]);
      out.pixels[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return out;
}

/** Darken toward the edges. strength 0…1, softness 0…1 (how far in it reaches). */
export function vignette(img: RasterImage, strength = 0.5, softness = 0.6, color: [number, number, number] = [0, 0, 0]): RasterImage {
  const out: RasterImage = { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const cx = img.width / 2, cy = img.height / 2;
  const maxD = Math.hypot(cx, cy);
  const k = Math.max(0, Math.min(1, strength));
  const start = 1 - Math.max(0.05, Math.min(1, softness));
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxD;
    const t = d <= start ? 0 : Math.min(1, (d - start) / (1 - start));
    const f = t * t * k;
    const i = (y * img.width + x) * 4;
    out.pixels[i] = Math.round(out.pixels[i] + (color[0] - out.pixels[i]) * f);
    out.pixels[i + 1] = Math.round(out.pixels[i + 1] + (color[1] - out.pixels[i + 1]) * f);
    out.pixels[i + 2] = Math.round(out.pixels[i + 2] + (color[2] - out.pixels[i + 2]) * f);
  }
  return out;
}

/** Deterministic film grain: monochrome noise, amount 0…1, seeded so re-runs match. */
export function grain(img: RasterImage, amount = 0.2, seed = 7): RasterImage {
  const out: RasterImage = { ...img, pixels: new Uint8ClampedArray(img.pixels) };
  const k = Math.max(0, Math.min(1, amount)) * 64;
  let s = seed >>> 0 || 1;
  const rnd = (): number => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) - 0.5; };
  for (let i = 0; i < out.pixels.length; i += 4) {
    const n = rnd() * k;
    for (let c = 0; c < 3; c++) {
      const v = out.pixels[i + c] + n;
      out.pixels[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return out;
}
