/**
 * Mark contrast + clearspace — the other half of measuring an identity.
 *
 * Split from marks.ts to keep both files inside the 700-line budget.
 */

import type { RasterImage } from '../../utils/png-codec';

export interface ContrastCase {
  background: string;
  /** WCAG contrast ratio between the mark's dominant ink and this background. */
  ratio: number;
  /** WCAG's threshold for non-text graphics. */
  passes: boolean;
}

export interface ContrastResult {
  /** Average colour of the mark's visible ink, as hex. */
  ink: string;
  cases: ContrastCase[];
  notes: string[];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
};

const toHex = (rgb: [number, number, number]): string =>
  '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance — the gamma-corrected one, not a naive average. */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Does the mark read on the backgrounds it will actually sit on?
 *
 * The defaults are white, black and a mid grey rather than a designer's chosen
 * palette, because a mark ends up on all three whether or not anyone planned
 * for it — a light footer, a dark hero, someone's slide deck. A mark that only
 * works on its own brand background is a mark that will be seen broken.
 *
 * 3:1 is WCAG's threshold for non-text graphics. A logo is not body copy, but
 * a mark under 3:1 is genuinely hard to make out, not merely subtle.
 */
export function markContrast(img: RasterImage, backgrounds = ['#FFFFFF', '#000000', '#808080']): ContrastResult {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.pixels.length; i += 4) {
    const a = img.pixels[i + 3];
    if (a < 128) continue;
    r += img.pixels[i]; g += img.pixels[i + 1]; b += img.pixels[i + 2];
    n++;
  }

  if (n === 0) {
    return { ink: '#000000', cases: [], notes: ['The mark has no visible pixels to measure.'] };
  }

  const ink: [number, number, number] = [r / n, g / n, b / n];
  const cases: ContrastCase[] = backgrounds.map(bg => {
    const ratio = contrastRatio(ink, hexToRgb(bg));
    return { background: bg, ratio: Math.round(ratio * 100) / 100, passes: ratio >= 3 };
  });

  const notes: string[] = [];
  const failed = cases.filter(c => !c.passes);
  // Unreachable with the default set, and deliberately kept: failing 3:1
  // against BOTH white and black is impossible (it needs luminance above 0.3
  // and below 0.1 at once). It fires only for a caller who passes their own
  // backgrounds — a brand palette of near-identical tones, say.
  if (failed.length === cases.length) {
    notes.push('The mark fails 3:1 on every tested background — its ink is mid-toned. Consider a darker or lighter variant.');
  } else if (failed.length > 0) {
    notes.push(`Fails 3:1 on ${failed.map(c => c.background).join(', ')} — supply an alternate mark for those, or avoid placing it there.`);
  }

  return { ink: toHex(ink), cases, notes };
}

export interface ClearspaceResult {
  /** The unit the rule is expressed in, px, derived from the mark itself. */
  unit: number;
  /** What the unit was measured from. */
  unitBasis: string;
  /** Recommended minimum padding on every side, px. */
  padding: number;
  /** Padding currently present in the raster, per side. */
  current: { top: number; right: number; bottom: number; left: number };
  notes: string[];
}

/**
 * Derive a clearspace rule from the mark's own geometry.
 *
 * Every identity manual states clearspace in terms of some feature of the mark
 * — the height of its letterform, the width of its stem — rather than a fixed
 * pixel count, because the rule has to survive rescaling. The stroke width is
 * the most reliable such feature to measure automatically: it is what the mark
 * is BUILT from, so a rule expressed in it scales exactly as the mark does.
 *
 * Stroke width is estimated as the median horizontal ink run, which is robust
 * against a few very long runs through a solid area.
 */
export function clearspace(img: RasterImage): ClearspaceResult {
  const { width, height, pixels } = img;
  const alphaAt = (x: number, y: number): number => pixels[(y * width + x) * 4 + 3];

  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) >= 128) { run++; continue; }
      if (run > 0) { runs.push(run); run = 0; }
    }
    if (run > 0) runs.push(run);
  }

  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    return {
      unit: 0, unitBasis: 'no visible ink', padding: 0,
      current: { top: 0, right: 0, bottom: 0, left: 0 },
      notes: ['The mark has no visible pixels to measure.'],
    };
  }

  runs.sort((a, b) => a - b);
  const markSize = Math.max(maxX - minX, maxY - minY, 1);
  const median = runs.length > 0 ? runs[Math.floor(runs.length / 2)] : 0;

  // A solid form has no stroke to measure, and the run length through it is its
  // own diameter — taking that as the unit produced advice like "696px of
  // clearspace" for a 400px disc on a 512px canvas. Anything above a quarter of
  // the mark is not a stroke, so fall back to a tenth of the mark: a filled
  // circle has no stem but still needs breathing room.
  const isSolid = median === 0 || median > markSize * 0.25;
  const unit = Math.max(1, Math.round(isSolid ? markSize / 10 : median));
  const unitBasis = isSolid
    ? `1/10 of the mark (${unit}px) — solid form, no stroke to measure`
    : `median stroke width (${unit}px)`;
  const padding = unit * 2;

  const current = {
    top: minY,
    left: minX,
    right: width - 1 - maxX,
    bottom: height - 1 - maxY,
  };

  const notes: string[] = [];
  const tight = (Object.entries(current) as [string, number][]).filter(([, v]) => v < padding);
  if (tight.length > 0) {
    notes.push(`Clearspace is ${padding}px (2x ${unitBasis}). Currently tight on: ${tight.map(([k, v]) => `${k} (${v}px)`).join(', ')}.`);
  }

  return { unit, unitBasis, padding, current, notes };
}
