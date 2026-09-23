/**
 * Cube and flip transitions in perspective, in a flat frame.
 *
 * SVG has no 3D, and an affine transform cannot draw the trapezoid a turning
 * face projects to — so cube-left/right played as slides and flip-h/v as a
 * squash through the centre line. Here a turning face is drawn as thin strips
 * of the scene, each clipped to its slice and scaled by that slice's depth:
 * a strip's edges land where the perspective projection puts them and its
 * height is the taller of its two ends, so together they cover the face; the
 * face is then clipped to the exact quadrilateral it projects to, so its
 * edges are straight lines and the steps between strips never show. The
 * count follows the depth range, so the content inside moves smoothly. That
 * is the vector frame — the editor's. A raster frame (GIF, MP4, op:frame)
 * instead draws each scene once and warps it onto the face's corners exactly
 * (warp.ts): strips cost a text layout per strip, the warp two renders.
 */

import type { ClipRect } from '../renderer/clip-rect';

/** One slice of a scene, clipped in the scene's own coordinates, then placed. */
export interface Strip { clip_rect: ClipRect; transform: string }
/**
 * A turning face: its strips, and the exact quadrilateral it projects to — as
 * a path the strips are clipped to, and as the canvas points the scene's
 * corners land on (top-left, top-right, bottom-right, bottom-left), which a
 * raster frame warps the scene onto (warp.ts).
 */
export interface Face { strips: Strip[]; outline: string; corners: Array<[number, number]> }

/** Strip counts: enough that neighbours differ in height by ≤ STEP_PX, within bounds. */
const MIN_STRIPS = 1, MAX_STRIPS = 96, STEP_PX = 1;
/** Camera distance, in canvas widths (heights for a vertical flip). */
const CAMERA = 2.4;

const f = (n: number): string => String(Number(n.toFixed(2)));
const RAD = Math.PI / 180;

/** Where face-local offset u (from the face's centre, along the turning direction) sits: across, and in depth. */
type Place = (u: number) => { across: number; depth: number };

/**
 * A face as strips. `axis` 'y' turns about a vertical axis (vertical strips
 * across the width), 'x' about a horizontal one. Empty when the face is edge
 * on or turned away — its strips would come out mirrored.
 */
export function faceStrips(axis: 'x' | 'y', w: number, h: number, place: Place): Face | null {
  const span = axis === 'y' ? w : h, other = axis === 'y' ? h : w;
  const mid = other / 2, d = CAMERA * span;
  const project = (u: number): { at: number; k: number } => {
    const p = place(u), k = d / (d + p.depth);
    return { at: span / 2 + p.across * k, k };
  };
  const ends = [project(-span / 2), project(span / 2)];
  const rise = Math.abs((ends[0]?.k ?? 1) - (ends[1]?.k ?? 1)) * (other / 2);
  const n = Math.min(MAX_STRIPS, Math.max(MIN_STRIPS, Math.ceil(rise / STEP_PX)));
  const out: Strip[] = [];
  const step = span / n;
  for (let i = 0; i < n; i++) {
    const a = i * step, b = a + step;
    const p0 = project(a - span / 2), p1 = project(b - span / 2);
    if (p1.at - p0.at < 0.05) return null;
    const along = (p1.at - p0.at) / step, k = Math.max(p0.k, p1.k);
    // Neighbours overlap by 1.5 screen px each side, or their anti-aliased edges let the backdrop through.
    const lap = 1.5 / Math.min(1, along);
    // Only inside the face: an overlap past its outer edges would pull in what lies off the canvas.
    const lo = Math.max(0, a - lap), hi = Math.min(span, b + lap);
    const clip = axis === 'y' ? { x: lo, y: 0, width: hi - lo, height: h } : { x: 0, y: lo, width: w, height: hi - lo };
    const transform = axis === 'y'
      ? `translate(${f(p0.at)} ${f(mid)}) scale(${f(along)} ${f(k)}) translate(${f(-a)} ${f(-mid)})`
      : `translate(${f(mid)} ${f(p0.at)}) scale(${f(k)} ${f(along)}) translate(${f(-mid)} ${f(-a)})`;
    out.push({ clip_rect: clip, transform });
  }
  const [e0 = { at: 0, k: 1 }, e1 = { at: span, k: 1 }] = ends;
  const corners: Array<[number, number]> = axis === 'y'
    ? [[e0.at, mid - mid * e0.k], [e1.at, mid - mid * e1.k], [e1.at, mid + mid * e1.k], [e0.at, mid + mid * e0.k]]
    : [[mid - mid * e0.k, e0.at], [mid + mid * e0.k, e0.at], [mid + mid * e1.k, e1.at], [mid - mid * e1.k, e1.at]];
  return { strips: out, outline: `M ${corners.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ')} Z`, corners };
}

/** A cube of side `span` turning about its centre, `span / 2` behind the screen; the face at `deg` from facing the viewer. */
export function cubeFace(deg: number, span: number): Place {
  const r = deg * RAD, half = span / 2;
  return u => ({ across: half * Math.sin(r) + u * Math.cos(r), depth: half - half * Math.cos(r) + u * Math.sin(r) });
}

/** A card turning about its own centre line; the face at `deg` from facing the viewer. */
export function cardFace(deg: number): Place {
  const r = deg * RAD;
  return u => ({ across: u * Math.cos(r), depth: u * Math.sin(r) });
}
