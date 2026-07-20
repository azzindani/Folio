/**
 * Median-cut colour quantization — RGBA pixels down to a GIF's 256-entry palette.
 *
 * GIF is an indexed format: every frame references at most 256 colours. Getting
 * there well matters more than it sounds, because the naive alternatives both
 * look broken on the flat colour and soft gradients this engine produces —
 * a fixed web-safe palette bands every gradient, and picking the 256 most
 * frequent colours drops small but important regions (an accent rule, a single
 * highlighted number) whose pixel count is tiny next to the background.
 *
 * Median cut instead splits colour SPACE by where the pixels actually are: the
 * box with the widest spread is halved at its median, repeatedly, so a large
 * flat area consumes one entry and a subtle gradient gets as many as it needs.
 */

export interface Palette {
  /** Flat RGB triples, length = size × 3. */
  rgb: Uint8Array;
  size: number;
  /** Index reserved for fully transparent pixels, or -1 when the image is opaque. */
  transparentIndex: number;
}

interface Box {
  pixels: number[]; // offsets into the source RGBA array, one per pixel
  rMin: number; rMax: number;
  gMin: number; gMax: number;
  bMin: number; bMax: number;
}

/** Alpha at or below this counts as transparent — GIF has no partial alpha. */
const ALPHA_CUTOFF = 128;

function makeBox(pixels: number[], src: Uint8ClampedArray): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const p of pixels) {
    const r = src[p], g = src[p + 1], b = src[p + 2];
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
}

/** Longest axis of a box, weighted for perception: green reads strongest, blue weakest. */
function widestChannel(box: Box): 0 | 1 | 2 {
  const dr = (box.rMax - box.rMin) * 0.30;
  const dg = (box.gMax - box.gMin) * 0.59;
  const db = (box.bMax - box.bMin) * 0.11;
  if (dr >= dg && dr >= db) return 0;
  return dg >= db ? 1 : 2;
}

function splitBox(box: Box, src: Uint8ClampedArray): [Box, Box] | null {
  if (box.pixels.length < 2) return null;
  const ch = widestChannel(box);
  const sorted = [...box.pixels].sort((a, b) => src[a + ch] - src[b + ch]);
  const mid = sorted.length >> 1;
  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);
  if (left.length === 0 || right.length === 0) return null;
  return [makeBox(left, src), makeBox(right, src)];
}

/**
 * Build a palette for one image.
 *
 * `maxColors` is 255 rather than 256 whenever the image has transparency,
 * because GIF spends one index on the transparent colour.
 */
export function buildPalette(pixels: Uint8ClampedArray, maxColors = 256): Palette {
  const opaque: number[] = [];
  let hasTransparent = false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < ALPHA_CUTOFF) hasTransparent = true;
    else opaque.push(i);
  }

  const budget = Math.max(2, Math.min(256, maxColors) - (hasTransparent ? 1 : 0));

  if (opaque.length === 0) {
    // Fully transparent frame: one dummy entry plus the transparent index.
    return { rgb: new Uint8Array([0, 0, 0]), size: 1, transparentIndex: hasTransparent ? 1 : -1 };
  }

  let boxes: Box[] = [makeBox(opaque, pixels)];
  while (boxes.length < budget) {
    // Always split the box with the widest spread — splitting the box with the
    // most PIXELS instead would spend the whole palette on a photographic
    // background and leave none for the small saturated areas that carry the design.
    let target = -1;
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.pixels.length < 2) continue;
      const ch = widestChannel(b);
      const spread = ch === 0 ? b.rMax - b.rMin : ch === 1 ? b.gMax - b.gMin : b.bMax - b.bMin;
      if (spread > best) { best = spread; target = i; }
    }
    if (target < 0 || best <= 0) break;

    const split = splitBox(boxes[target], pixels);
    if (!split) break;
    boxes = [...boxes.slice(0, target), ...split, ...boxes.slice(target + 1)];
  }

  const rgb = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0;
    for (const p of box.pixels) { r += pixels[p]; g += pixels[p + 1]; b += pixels[p + 2]; }
    const n = box.pixels.length;
    rgb[i * 3] = Math.round(r / n);
    rgb[i * 3 + 1] = Math.round(g / n);
    rgb[i * 3 + 2] = Math.round(b / n);
  });

  return { rgb, size: boxes.length, transparentIndex: hasTransparent ? boxes.length : -1 };
}

/**
 * Map every pixel to its nearest palette entry.
 *
 * Nearest-colour search is the hot loop of a GIF export — for a 1440×1440 frame
 * it runs two million times against up to 256 entries. The cache keyed on the
 * exact colour turns that into one search per DISTINCT colour, and flat design
 * work has very few distinct colours, so it is the difference between a export
 * that takes a second and one that takes a minute.
 */
export function mapToPalette(pixels: Uint8ClampedArray, palette: Palette): Uint8Array {
  const count = pixels.length / 4;
  const out = new Uint8Array(count);
  const cache = new Map<number, number>();
  const transparent = palette.transparentIndex >= 0 ? palette.transparentIndex : 0;

  for (let i = 0, p = 0; i < count; i++, p += 4) {
    if (pixels[p + 3] < ALPHA_CUTOFF) { out[i] = transparent; continue; }

    const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) { out[i] = hit; continue; }

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let c = 0; c < palette.size; c++) {
      const dr = r - palette.rgb[c * 3];
      const dg = g - palette.rgb[c * 3 + 1];
      const db = b - palette.rgb[c * 3 + 2];
      const dist = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
      if (dist < bestDist) { bestDist = dist; bestIdx = c; }
    }
    cache.set(key, bestIdx);
    out[i] = bestIdx;
  }

  return out;
}
