// Honor a deliberately-requested poster aspect ratio.
//
// A boxless content preset (sections / infographic / editorial / …) sizes its
// group to its own measured content height so a poster can auto-fit to it with
// no dead band (see engine-layer-tools + shorthand-recover). That auto-fit then
// sets `document.height = group.height` — which SILENTLY changes a canvas the
// user explicitly created at, say, 1080×1350 (4:5) into 1080×1800 (3:5). Users
// who asked for "a 4:5 poster" get the wrong ratio back.
//
// When the document was created with a recognized standard PORTRAIT/SQUARE ratio
// and a single content preset IS the whole poster, we instead PRESERVE that
// ratio: grow the canvas to the smallest box of the requested ratio that
// contains the measured content, then SCALE the content horizontally to fill
// the widened canvas (and stretch the preset's full-bleed background layers to
// fill). Honoring the ratio means growing the canvas WIDER than the content
// column; an earlier version just centered the fixed-width column, which left
// big dead bands on the left and right ("too much dead space"). Instead we
// apply a horizontal scale `sx = newW/gw` to every layer's x and width, so the
// preset's chosen margin stays proportional and the text area becomes
// `canvasWidth − margin` again. Only the horizontal axis scales: y/height are
// untouched (vertical rhythm unchanged) and font sizes are NOT scaled — text
// just reflows into wider boxes (fewer wraps, never clipped). Aspect-locked
// layers (circle/ellipse/image) reposition by center but keep their size so the
// stretch can't distort them into ovals.

import type { Layer } from '../schema/types';

// Standard portrait/square poster ratios (width / height). 4:5 social, 2:3
// print, 3:4, 1:1, 9:16 story, ISO A-series (1:√2). Landscape is intentionally
// excluded — there the "model picked a mismatched canvas" auto-fit rescue
// matters more than honoring a ratio the model likely chose by accident.
const STANDARD_RATIOS: readonly number[] = [
  4 / 5,            // 0.800  — Instagram portrait
  3 / 4,            // 0.750
  5 / 7,            // 0.714  — common print
  1 / Math.SQRT2,   // 0.707  — ISO A-series
  2 / 3,            // 0.667
  9 / 16,           // 0.5625 — story / reel
  1,                // 1.000  — square
];

const TOL = 0.02;

/** True when `w×h` matches a standard portrait/square poster ratio (≤ square). */
export function isDeliberatePosterRatio(w: number, h: number): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  const r = w / h;
  if (r > 1 + TOL) return false; // portrait or square only
  return STANDARD_RATIOS.some(s => Math.abs(r - s) <= TOL);
}

function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// A full-bleed background layer within the original group box: a rect/shape/
// path/image spanning ~the whole content box from the origin. Stretched to fill
// the grown canvas instead of being shifted, so no unpainted margin appears.
function isFullBleedBg(o: Record<string, unknown>, gw: number, gh: number): boolean {
  const t = o['type'];
  if (t !== 'rect' && t !== 'shape' && t !== 'path' && t !== 'image' && t !== 'polygon') return false;
  return num(o, 'x') <= gw * 0.02 && num(o, 'y') <= gh * 0.02
    && num(o, 'width') >= gw * 0.92 && num(o, 'height') >= gh * 0.92;
}

// Returns true if the subtree contains a flex/relative container whose children
// are positioned by layout rather than absolute coords — shifting absolute x/y
// would be wrong there, so we bail and leave the legacy auto-fit in charge.
function hasRelativeLayout(layer: Layer): boolean {
  const o = layer as unknown as Record<string, unknown>;
  if (o['type'] === 'auto_layout') return true;
  const kids = o['layers'];
  return Array.isArray(kids) && (kids as Layer[]).some(hasRelativeLayout);
}

function scaleOrFill(layer: Layer, sx: number, gw: number, gh: number, newW: number, newH: number): void {
  const o = layer as unknown as Record<string, unknown>;
  const kids = o['layers'];
  if (Array.isArray(kids)) for (const k of kids as Layer[]) scaleOrFill(k, sx, gw, gh, newW, newH);
  if (o['type'] === 'group') return; // outer/nested wrappers: children carry the coords
  if (isFullBleedBg(o, gw, gh)) {
    o['x'] = 0; o['y'] = 0; o['width'] = newW; o['height'] = newH;
    return;
  }
  const t = o['type'];
  const w = num(o, 'width');
  // Aspect-locked layers: reposition by center, keep size — a horizontal-only
  // stretch would otherwise turn a circle into an ellipse / squash an image.
  if (t === 'circle' || t === 'ellipse' || t === 'image') {
    o['x'] = Math.round((num(o, 'x') + w / 2) * sx - w / 2);
    return;
  }
  o['x'] = Math.round(num(o, 'x') * sx);
  if (w > 0) o['width'] = Math.round(w * sx);
}

/**
 * If `reqW×reqH` is a deliberate standard poster ratio, re-fit the sole content
 * `group` (and any sibling full-canvas `others`) to preserve that ratio and
 * return the new document size. Mutates the layers in place. Returns null when
 * the ratio is non-standard or the layout can't be safely re-fitted (caller
 * keeps the legacy content-fit behavior).
 */
export function honorPosterRatio(
  group: Layer,
  others: Layer[],
  reqW: number,
  reqH: number,
): { width: number; height: number } | null {
  if (!isDeliberatePosterRatio(reqW, reqH)) return null;
  if (hasRelativeLayout(group)) return null;
  const g = group as unknown as Record<string, unknown>;
  const gw = num(g, 'width'), gh = num(g, 'height');
  if (gw <= 0 || gh <= 0) return null;

  // Only act when the content is TALLER than the requested canvas — that is the
  // bug: the legacy auto-fit grows the doc to the content's height, turning 4:5
  // into 3:5. When content FITS (gh ≤ reqH) the legacy content-fit (shrink the
  // doc to the content, no dead band — the "sage-block" behavior) is correct and
  // we stay out of its way. We can't tell a deliberate ratio from a model's
  // arbitrarily-oversized canvas for short content, so we don't try.
  if (gh <= reqH) return null;

  const ratio = reqW / reqH;
  // Smallest box of `ratio` (w/h) that contains gw×gh.
  let newW = Math.max(gw, Math.round(gh * ratio));
  let newH = Math.round(newW / ratio);
  if (newH < gh) { newH = gh; newW = Math.round(gh * ratio); }

  // Already the requested ratio at the natural size → nothing to do.
  if (newW === gw && newH === gh) {
    return null;
  }

  // Scale the content horizontally to FILL the widened canvas (sx ≥ 1 — we only
  // ever grow width here). This keeps the preset's margin proportional instead
  // of leaving the original-width column centered with dead bands on both sides.
  // Vertical layout is left as-is and top-anchored: a preset can slightly
  // under-estimate its own height, and not touching y/height only ever gives any
  // such overflow MORE room ([gh, newH]) rather than pushing it off the bottom.
  const sx = newW / gw;
  scaleOrFill(group, sx, gw, gh, newW, newH);
  g['x'] = 0; g['y'] = 0; g['width'] = newW; g['height'] = newH;
  for (const r of others) {
    const ro = r as unknown as Record<string, unknown>;
    ro['x'] = 0; ro['y'] = 0; ro['width'] = newW; ro['height'] = newH;
  }
  return { width: newW, height: newH };
}
