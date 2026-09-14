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
 *
 * It runs over a HISTOGRAM — each distinct colour once, weighted by its pixel
 * count — not over the pixels. The first version sorted an array holding every
 * pixel offset at every split: 555ms per 1080×1350 frame, measured in the live
 * container, which made a 30s export take minutes. A flat design frame has a few
 * thousand distinct colours (mostly antialiasing), so the same cut over the
 * histogram is the same palette for a fraction of the work.
 */

export interface Palette {
  /** Flat RGB triples, length = size × 3. */
  rgb: Uint8Array;
  size: number;
  /** Index reserved for fully transparent pixels, or -1 when the image is opaque. */
  transparentIndex: number;
}

/** Alpha at or below this counts as transparent — GIF has no partial alpha. */
const ALPHA_CUTOFF = 128;

/** Distinct colours kept exactly; past this (a photo) colours share 5-bit bins. */
const MAX_EXACT = 1 << 16;
const FULL_MASK = 0xffffff;
const COARSE_MASK = 0xf8f8f8;

interface Histogram {
  /** Colour key per entry, 0xRRGGBB (masked). */
  keys: Uint32Array;
  counts: Uint32Array;
  /** Summed real r,g,b per entry — the box average stays the true pixel mean. */
  sums: Float64Array;
  size: number;
  hasTransparent: boolean;
  overflowed: boolean;
}

function histogram(px: Uint8ClampedArray, mask: number, limit: number): Histogram {
  const index = new Map<number, number>();
  let cap = 1024;
  let keys = new Uint32Array(cap);
  let counts = new Uint32Array(cap);
  let sums = new Float64Array(cap * 3);
  let size = 0;
  let hasTransparent = false;
  // Flat work is long runs of one colour, so most pixels skip the Map entirely.
  let lastKey = -1;
  let lastIdx = 0;

  for (let p = 0; p < px.length; p += 4) {
    if (px[p + 3] < ALPHA_CUTOFF) { hasTransparent = true; continue; }
    const r = px[p], g = px[p + 1], b = px[p + 2];
    const key = ((r << 16) | (g << 8) | b) & mask;
    if (key !== lastKey) {
      const hit = index.get(key);
      if (hit === undefined) {
        if (size >= limit) return { keys, counts, sums, size, hasTransparent, overflowed: true };
        if (size === cap) {
          cap *= 2;
          const k = new Uint32Array(cap); k.set(keys); keys = k;
          const c = new Uint32Array(cap); c.set(counts); counts = c;
          const s = new Float64Array(cap * 3); s.set(sums); sums = s;
        }
        lastIdx = size++;
        index.set(key, lastIdx);
        keys[lastIdx] = key;
      } else {
        lastIdx = hit;
      }
      lastKey = key;
    }
    counts[lastIdx]++;
    sums[lastIdx * 3] += r; sums[lastIdx * 3 + 1] += g; sums[lastIdx * 3 + 2] += b;
  }
  return { keys, counts, sums, size, hasTransparent, overflowed: false };
}

/** A contiguous run of `order`, the histogram entries one palette colour will stand for. */
interface Box { start: number; end: number; count: number; spread: number; shift: 16 | 8 | 0 }

function measure(h: Histogram, order: Uint32Array, start: number, end: number): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, count = 0;
  for (let k = start; k < end; k++) {
    const e = order[k];
    const key = h.keys[e];
    const r = key >>> 16, g = (key >>> 8) & 255, b = key & 255;
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    count += h.counts[e];
  }
  // Longest axis, weighted for perception: green reads strongest, blue weakest.
  const dr = (rMax - rMin) * 0.30, dg = (gMax - gMin) * 0.59, db = (bMax - bMin) * 0.11;
  if (dr >= dg && dr >= db) return { start, end, count, spread: rMax - rMin, shift: 16 };
  if (dg >= db) return { start, end, count, spread: gMax - gMin, shift: 8 };
  return { start, end, count, spread: bMax - bMin, shift: 0 };
}

/** Halve a box at its PIXEL median along its widest channel. */
function split(h: Histogram, order: Uint32Array, box: Box): [Box, Box] {
  const { shift } = box;
  order.subarray(box.start, box.end).sort((a, b) => ((h.keys[a] >>> shift) & 255) - ((h.keys[b] >>> shift) & 255));
  const half = box.count / 2;
  let cum = 0;
  let mid = box.end - 1;
  for (let k = box.start; k < box.end - 1; k++) {
    cum += h.counts[order[k]];
    if (cum >= half) { mid = k + 1; break; }
  }
  return [measure(h, order, box.start, mid), measure(h, order, mid, box.end)];
}

/**
 * Build a palette for one image.
 *
 * `maxColors` is 255 rather than 256 whenever the image has transparency,
 * because GIF spends one index on the transparent colour.
 */
export function buildPalette(pixels: Uint8ClampedArray, maxColors = 256): Palette {
  let h = histogram(pixels, FULL_MASK, MAX_EXACT);
  if (h.overflowed) h = histogram(pixels, COARSE_MASK, Infinity);

  if (h.size === 0) {
    // Fully transparent frame: one dummy entry plus the transparent index.
    return { rgb: new Uint8Array([0, 0, 0]), size: 1, transparentIndex: h.hasTransparent ? 1 : -1 };
  }

  const budget = Math.max(2, Math.min(256, maxColors) - (h.hasTransparent ? 1 : 0));
  const order = new Uint32Array(h.size);
  for (let i = 0; i < h.size; i++) order[i] = i;

  const boxes: Box[] = [measure(h, order, 0, h.size)];
  while (boxes.length < budget) {
    // Always split the box with the widest spread — splitting the box with the
    // most PIXELS instead would spend the whole palette on a photographic
    // background and leave none for the small saturated areas that carry the design.
    let target = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.end - b.start >= 2 && b.spread > best) { best = b.spread; target = i; }
    }
    if (target < 0) break;
    boxes.splice(target, 1, ...split(h, order, boxes[target]));
  }

  const rgb = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = box.start; k < box.end; k++) {
      const e = order[k];
      r += h.sums[e * 3]; g += h.sums[e * 3 + 1]; b += h.sums[e * 3 + 2]; n += h.counts[e];
    }
    rgb[i * 3] = Math.round(r / n);
    rgb[i * 3 + 1] = Math.round(g / n);
    rgb[i * 3 + 2] = Math.round(b / n);
  });

  return { rgb, size: boxes.length, transparentIndex: h.hasTransparent ? boxes.length : -1 };
}

function nearest(palette: Palette, r: number, g: number, b: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let c = 0; c < palette.size; c++) {
    const dr = r - palette.rgb[c * 3];
    const dg = g - palette.rgb[c * 3 + 1];
    const db = b - palette.rgb[c * 3 + 2];
    const dist = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
    if (dist < bestDist) { bestDist = dist; bestIdx = c; }
  }
  return bestIdx;
}

/**
 * Map every pixel to its nearest palette entry.
 *
 * Nearest-colour search is the hot loop of a GIF export — for a 1440×1440 frame
 * it runs two million times against up to 256 entries. The cache keyed on the
 * exact colour turns that into one search per DISTINCT colour, and a run of one
 * colour (most of a flat design) skips even the cache lookup.
 */
export function mapToPalette(pixels: Uint8ClampedArray, palette: Palette): Uint8Array {
  const count = pixels.length / 4;
  const out = new Uint8Array(count);
  const cache = new Map<number, number>();
  const transparent = palette.transparentIndex >= 0 ? palette.transparentIndex : 0;
  let lastKey = -1;
  let lastIdx = 0;

  for (let i = 0, p = 0; i < count; i++, p += 4) {
    if (pixels[p + 3] < ALPHA_CUTOFF) { out[i] = transparent; continue; }
    const key = (pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2];
    if (key !== lastKey) {
      let idx = cache.get(key);
      if (idx === undefined) {
        idx = nearest(palette, pixels[p], pixels[p + 1], pixels[p + 2]);
        cache.set(key, idx);
      }
      lastKey = key;
      lastIdx = idx;
    }
    out[i] = lastIdx;
  }
  return out;
}
