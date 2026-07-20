/**
 * Mark geometry — measuring an identity mark the model cannot see.
 *
 * This is NOT a logo generator, and the distinction is the whole point. A tool
 * that stamps marks out of presets makes every output look like every other
 * output, which CLAUDE.md §0.4 rules out and which every AI logo product on the
 * market demonstrates. The model draws the mark; the engine measures whether it
 * holds up.
 *
 * What it measures is exactly what a model working without eyes cannot check
 * for itself: whether the mark LOOKS centred (which is not the same as being
 * centred), whether it survives being shrunk to a favicon, whether it reads on
 * the backgrounds it will actually sit on, and how much room it needs around it.
 */

import type { RasterImage } from '../../utils/png-codec';

export interface OpticalCenterResult {
  /** Centre of the bounding box, in px from the raster's top-left. */
  geometric: { x: number; y: number };
  /** Centre of MASS of the visible ink. */
  optical: { x: number; y: number };
  /** Optical minus geometric, in px. Positive x = ink sits right of centre. */
  offset: { x: number; y: number };
  /** Offset as a fraction of the mark's size — what actually matters at any scale. */
  offsetFraction: { x: number; y: number };
  /** True when the mark is far enough off that a viewer would notice. */
  needsAdjustment: boolean;
}

/**
 * Where the ink actually sits, versus where the box says it does.
 *
 * A play triangle is the classic case: centre it by bounding box and it looks
 * pushed left, every time, because the mass is concentrated at the flat edge
 * while the box is defined by the far point. Designers nudge it right by eye.
 * Centroid-of-ink is that nudge, computed.
 *
 * Alpha weights the centroid, so a soft or antialiased edge contributes in
 * proportion to how visible it is rather than counting as fully present.
 *
 * LIMIT, worth stating plainly: this weighs the composite SILHOUETTE. A white
 * triangle on a solid disc is opaque everywhere, so the centroid lands on the
 * disc's centre and the triangle's own placement inside it is invisible here.
 * Detecting that needs the inner shape rendered alone. Weighting by luminance
 * instead would find it, but would then mismeasure every single-colour mark —
 * a black silhouette on transparency has no luminance variation at all.
 */
export function opticalCenter(img: RasterImage): OpticalCenterResult {
  const { width, height, pixels } = img;

  let minX = width, maxX = -1, minY = height, maxY = -1;
  let sumX = 0, sumY = 0, sumW = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixels[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const w = a / 255;
      sumX += x * w; sumY += y * w; sumW += w;
    }
  }

  if (maxX < 0 || sumW === 0) {
    const c = { x: width / 2, y: height / 2 };
    return {
      geometric: c, optical: c,
      offset: { x: 0, y: 0 },
      offsetFraction: { x: 0, y: 0 },
      needsAdjustment: false,
    };
  }

  const geometric = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const optical = { x: sumX / sumW, y: sumY / sumW };
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const offset = { x: optical.x - geometric.x, y: optical.y - geometric.y };
  const offsetFraction = { x: offset.x / spanX, y: offset.y / spanY };

  // 2% of the mark's own size is about where a trained eye starts to see it.
  // Reporting every sub-pixel wobble would bury the cases that matter.
  const needsAdjustment = Math.abs(offsetFraction.x) > 0.02 || Math.abs(offsetFraction.y) > 0.02;

  return { geometric, optical, offset, offsetFraction, needsAdjustment };
}

export interface ScaleSurvivalStep {
  size: number;
  /** Distinct luminance levels left after rendering this small. */
  detail: number;
  /** Fraction of the tile covered by ink — collapses toward 0 or 1 when detail is lost. */
  coverage: number;
  legible: boolean;
}

export interface ScaleSurvivalResult {
  steps: ScaleSurvivalStep[];
  /** Smallest size at which the mark still reads. */
  minimumSize: number | null;
  notes: string[];
}

/**
 * Does the mark survive being small?
 *
 * A mark is used at 16px in a browser tab and 512px on a poster, and detail
 * that reads beautifully at one vanishes or turns to mud at the other. This
 * downsamples by area-averaging — the same thing a screen does — and reports
 * where structure stops being distinguishable.
 *
 * Rendering is area-average rather than nearest-neighbour deliberately: point
 * sampling can drop a thin stroke entirely at one size and keep it at the next,
 * which would report noise instead of a trend.
 */
export function scaleSurvival(img: RasterImage, sizes = [16, 24, 32, 64, 128, 512]): ScaleSurvivalResult {
  const steps: ScaleSurvivalStep[] = [];
  const notes: string[] = [];

  const baseline = distinctLevels(img);
  // Legibility is judged against the mark's own full-size coverage, not an
  // absolute threshold. Colour VARIETY is the wrong signal: a bold one-colour
  // silhouette — the mark most likely to survive anywhere — has a single
  // luminance level, and gating on level count would report the best marks as
  // the worst. What actually breaks when a mark shrinks is its ink coverage:
  // hairlines average away toward nothing, and tight counters fill in toward
  // solid. Either way the small render stops resembling the large one.
  const reference = inkCoverage(img);

  for (const size of sizes) {
    const small = areaDownsample(img, size);
    const detail = distinctLevels(small);
    const coverage = inkCoverage(small);
    const drift = Math.abs(coverage - reference) / Math.max(reference, 0.01);
    const legible = coverage > 0.01 && coverage < 0.99 && drift < 0.5;
    steps.push({ size, detail, coverage: round3(coverage), legible });
  }

  const firstLegible = steps.find(s => s.legible);
  const minimumSize = firstLegible ? firstLegible.size : null;

  if (!minimumSize) {
    notes.push('The mark does not read at any tested size — it may be blank, or a single flat shape with no internal structure.');
  } else if (minimumSize > 32) {
    notes.push(`Illegible below ${minimumSize}px. That rules out favicons and small app icons; simplify the mark or ship a separate reduced version for small sizes.`);
  }

  const smallest = steps[0];
  if (smallest && baseline > 8 && smallest.detail <= 3) {
    notes.push(`Detail collapses from ${baseline} levels to ${smallest.detail} at ${smallest.size}px — fine strokes or small counters are being lost.`);
  }

  return { steps, minimumSize, notes };
}

/** Box-average downsample to a square of `size`, preserving alpha weighting. */
export function areaDownsample(img: RasterImage, size: number): RasterImage {
  const out = new Uint8ClampedArray(size * size * 4);
  const sx = img.width / size;
  const sy = img.height / size;

  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.pixels[i]; g += img.pixels[i + 1]; b += img.pixels[i + 2]; a += img.pixels[i + 3];
          n++;
        }
      }
      const d = (y * size + x) * 4;
      if (n > 0) {
        out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n;
      }
    }
  }

  return { width: size, height: size, pixels: out };
}

/** Count of distinct luminance buckets among visible pixels — a proxy for structure. */
function distinctLevels(img: RasterImage): number {
  const seen = new Set<number>();
  for (let i = 0; i < img.pixels.length; i += 4) {
    if (img.pixels[i + 3] < 16) continue;
    const lum = (img.pixels[i] * 0.299 + img.pixels[i + 1] * 0.587 + img.pixels[i + 2] * 0.114);
    seen.add(Math.round(lum / 16)); // 16 buckets
  }
  return seen.size;
}

/** Fraction of pixels carrying visible ink. */
function inkCoverage(img: RasterImage): number {
  let ink = 0;
  const total = img.pixels.length / 4;
  for (let i = 0; i < img.pixels.length; i += 4) if (img.pixels[i + 3] >= 128) ink++;
  return total === 0 ? 0 : ink / total;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
