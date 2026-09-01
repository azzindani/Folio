/**
 * Pixel adjustments — the Photoshop "Image → Adjustments" menu as pure
 * functions over RGBA buffers.
 *
 * Everything is in-place on a `RasterImage` and dependency-free: the deployed
 * container has no canvas, sharp or ImageMagick, and a model working over MCP
 * still needs to brighten a screenshot, desaturate a photo behind a headline
 * or push a logo to a flat tint. Each function is one adjustment; `adjust()`
 * applies a spec in the order Photoshop's own stack would (tonal first, colour
 * second, stylistic last) so results are predictable.
 */

import type { RasterImage } from './png-codec';

export interface AdjustSpec {
  /** -100…100. Additive shift of every channel. */
  brightness?: number;
  /** -100…100. Contrast about mid-grey. */
  contrast?: number;
  /** Exposure in stops, -3…3. Multiplicative. */
  exposure?: number;
  /** Gamma, 0.2…5. 1 = unchanged; <1 brightens midtones. */
  gamma?: number;
  /** Levels: input black/white points (0…255) remapped to full range. */
  levels?: { black?: number; white?: number };
  /** Saturation multiplier: 0 = grayscale, 1 = unchanged, 2 = punchy. */
  saturation?: number;
  /** Hue rotation, degrees. */
  hue?: number;
  /** Invert colours (negative). */
  invert?: boolean;
  /** Sepia strength 0…1. */
  sepia?: number;
  /** Two-tone luminance remap: dark → shadow, light → highlight (hex). */
  duotone?: { shadow: string; highlight: string };
  /** Multiply by a colour — a tint wash. Hex + strength 0…1. */
  tint?: { color: string; strength?: number };
  /** Posterize to N levels per channel, 2…16. */
  posterize?: number;
  /** Threshold at 0…255 → pure black/white. */
  threshold?: number;
  /** Alpha multiplier 0…1. */
  opacity?: number;
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Apply a per-channel lookup table — the fast path for every tonal curve. */
function applyLUT(img: RasterImage, lut: Uint8ClampedArray): void {
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = lut[p[i]]; p[i + 1] = lut[p[i + 1]]; p[i + 2] = lut[p[i + 2]];
  }
}

function lut(fn: (v: number) => number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = clamp(Math.round(fn(i)));
  return t;
}

export function brightness(img: RasterImage, amount: number): void {
  const d = (Math.max(-100, Math.min(100, amount)) / 100) * 255;
  applyLUT(img, lut(v => v + d));
}

export function contrast(img: RasterImage, amount: number): void {
  const c = Math.max(-100, Math.min(100, amount));
  const f = (259 * (c + 255)) / (255 * (259 - c));
  applyLUT(img, lut(v => f * (v - 128) + 128));
}

export function exposure(img: RasterImage, stops: number): void {
  const k = Math.pow(2, Math.max(-3, Math.min(3, stops)));
  applyLUT(img, lut(v => v * k));
}

export function gamma(img: RasterImage, g: number): void {
  const gg = Math.max(0.2, Math.min(5, g));
  applyLUT(img, lut(v => 255 * Math.pow(v / 255, 1 / gg)));
}

export function levels(img: RasterImage, black = 0, white = 255): void {
  const b = Math.max(0, Math.min(254, black));
  const w = Math.max(b + 1, Math.min(255, white));
  applyLUT(img, lut(v => ((v - b) / (w - b)) * 255));
}

export function invert(img: RasterImage): void {
  applyLUT(img, lut(v => 255 - v));
}

export function posterize(img: RasterImage, levelsN: number): void {
  const n = Math.max(2, Math.min(16, Math.round(levelsN)));
  applyLUT(img, lut(v => Math.round(Math.round((v / 255) * (n - 1)) / (n - 1) * 255)));
}

export function threshold(img: RasterImage, at: number): void {
  const t = Math.max(0, Math.min(255, at));
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    const v = l >= t ? 255 : 0;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
}

export function saturation(img: RasterImage, s: number): void {
  const k = Math.max(0, s);
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    p[i] = clamp(l + (p[i] - l) * k);
    p[i + 1] = clamp(l + (p[i + 1] - l) * k);
    p[i + 2] = clamp(l + (p[i + 2] - l) * k);
  }
}

/** Hue rotation via the standard luminance-preserving rotation matrix. */
export function hueRotate(img: RasterImage, degrees: number): void {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    p[i] = clamp(m[0] * r + m[1] * g + m[2] * b);
    p[i + 1] = clamp(m[3] * r + m[4] * g + m[5] * b);
    p[i + 2] = clamp(m[6] * r + m[7] * g + m[8] * b);
  }
}

export function sepia(img: RasterImage, strength: number): void {
  const k = Math.max(0, Math.min(1, strength));
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const sr = 0.393 * r + 0.769 * g + 0.189 * b;
    const sg = 0.349 * r + 0.686 * g + 0.168 * b;
    const sb = 0.272 * r + 0.534 * g + 0.131 * b;
    p[i] = clamp(r + (sr - r) * k); p[i + 1] = clamp(g + (sg - g) * k); p[i + 2] = clamp(b + (sb - b) * k);
  }
}

export function duotone(img: RasterImage, shadow: string, highlight: string): void {
  const [sr, sg, sb] = hexToRgb(shadow);
  const [hr, hg, hb] = hexToRgb(highlight);
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const l = (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255;
    p[i] = clamp(sr + (hr - sr) * l); p[i + 1] = clamp(sg + (hg - sg) * l); p[i + 2] = clamp(sb + (hb - sb) * l);
  }
}

export function tint(img: RasterImage, color: string, strength = 1): void {
  const [tr, tg, tb] = hexToRgb(color);
  const k = Math.max(0, Math.min(1, strength));
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = clamp(p[i] + ((p[i] * tr) / 255 - p[i]) * k);
    p[i + 1] = clamp(p[i + 1] + ((p[i + 1] * tg) / 255 - p[i + 1]) * k);
    p[i + 2] = clamp(p[i + 2] + ((p[i + 2] * tb) / 255 - p[i + 2]) * k);
  }
}

export function opacity(img: RasterImage, k: number): void {
  const a = Math.max(0, Math.min(1, k));
  const p = img.pixels;
  for (let i = 3; i < p.length; i += 4) p[i] = clamp(p[i] * a);
}

/** True when the spec asks for anything. */
export function hasAdjust(spec: AdjustSpec | undefined): spec is AdjustSpec {
  return !!spec && Object.values(spec).some(v => v !== undefined);
}

/**
 * Apply a whole AdjustSpec in Photoshop stack order. Returns the notes the
 * caller surfaces so a blind model knows what happened to its pixels.
 */
export function adjust(img: RasterImage, spec: AdjustSpec): string[] {
  const notes: string[] = [];
  if (spec.levels) { levels(img, spec.levels.black, spec.levels.white); notes.push(`levels ${spec.levels.black ?? 0}–${spec.levels.white ?? 255}`); }
  if (spec.exposure !== undefined && spec.exposure !== 0) { exposure(img, spec.exposure); notes.push(`exposure ${spec.exposure > 0 ? '+' : ''}${spec.exposure} stops`); }
  if (spec.brightness !== undefined && spec.brightness !== 0) { brightness(img, spec.brightness); notes.push(`brightness ${spec.brightness}`); }
  if (spec.contrast !== undefined && spec.contrast !== 0) { contrast(img, spec.contrast); notes.push(`contrast ${spec.contrast}`); }
  if (spec.gamma !== undefined && spec.gamma !== 1) { gamma(img, spec.gamma); notes.push(`gamma ${spec.gamma}`); }
  if (spec.hue !== undefined && spec.hue % 360 !== 0) { hueRotate(img, spec.hue); notes.push(`hue ${spec.hue}°`); }
  if (spec.saturation !== undefined && spec.saturation !== 1) { saturation(img, spec.saturation); notes.push(spec.saturation === 0 ? 'grayscale' : `saturation ×${spec.saturation}`); }
  if (spec.invert) { invert(img); notes.push('inverted'); }
  if (spec.sepia) { sepia(img, spec.sepia); notes.push(`sepia ${spec.sepia}`); }
  if (spec.duotone) { duotone(img, spec.duotone.shadow, spec.duotone.highlight); notes.push(`duotone ${spec.duotone.shadow}→${spec.duotone.highlight}`); }
  if (spec.tint) { tint(img, spec.tint.color, spec.tint.strength); notes.push(`tint ${spec.tint.color}`); }
  if (spec.posterize) { posterize(img, spec.posterize); notes.push(`posterize ${spec.posterize}`); }
  if (spec.threshold !== undefined) { threshold(img, spec.threshold); notes.push(`threshold ${spec.threshold}`); }
  if (spec.opacity !== undefined && spec.opacity !== 1) { opacity(img, spec.opacity); notes.push(`opacity ${spec.opacity}`); }
  return notes;
}
