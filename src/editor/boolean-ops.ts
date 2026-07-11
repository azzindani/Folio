// WP-4.7 — path boolean operations (union / subtract / intersect / exclude).
// Two selected shape layers → one NEW `path` layer holding the boolean result,
// so the combined shape is a first-class layer that renders identically in the
// editor and in resvg export (it's just an SVG path `d`).
//
// Geometry: each layer is flattened to polygon ring(s), the boolean runs on the
// rings (via the bundled `polygon-clipping` — NO runtime CDN, lazy-imported so
// it stays out of the main entry chunk), and the result is serialized back to a
// path `d`. Rect/ellipse/polygon flatten purely (unit-testable); `path` layers
// are sampled through an off-DOM SVG path element (editor runs in the browser).

import type { Layer } from '../schema/types';

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

type Ring = number[][];            // [[x,y], …] (implicitly closed)
type Poly = Ring[];                // outer ring + holes
type MultiPoly = Poly[];

const TWO_PI = Math.PI * 2;

// ── layer → bounding box (px) ───────────────────────────────
interface Box { x: number; y: number; w: number; h: number }
function layerBox(l: Record<string, unknown>): Box | null {
  const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cx = n(l.cx), cy = n(l.cy), rx = n(l.rx), ry = n(l.ry);
  let x = n(l.x), y = n(l.y), w = n(l.width), h = n(l.height);
  if (x === undefined && cx !== undefined && rx !== undefined) { x = cx - rx; w = rx * 2; }
  if (y === undefined && cy !== undefined && ry !== undefined) { y = cy - ry; h = ry * 2; }
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h };
}

function ellipseRing(box: Box, steps = 64): Ring {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TWO_PI;
    ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return ring;
}

function polygonPointsRing(points: string): Ring | null {
  const nums = points.trim().split(/[\s,]+/).map(Number).filter(v => Number.isFinite(v));
  if (nums.length < 6) return null;
  const ring: Ring = [];
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  return ring;
}

function regularPolygonRing(box: Box, sides: number): Ring {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  const ring: Ring = [];
  for (let i = 0; i < sides; i++) {
    const t = -Math.PI / 2 + (i / sides) * TWO_PI;
    ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return ring;
}

/** Flatten a `path` layer's `d` by sampling an off-DOM SVG path element. Returns
 *  null when the DOM path API is unavailable (non-browser) or `d` is empty. */
function samplePathD(d: string, spacing = 4, cap = 400): Ring | null {
  if (typeof document === 'undefined' || !d) return null;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.setAttribute('d', d);
  const total = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
  if (!total) return null;
  const n = Math.max(3, Math.min(cap, Math.round(total / spacing)));
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = el.getPointAtLength((i / n) * total);
    ring.push([p.x, p.y]);
  }
  return ring;
}

/** A layer → its polygon (outer ring, no holes). null for unsupported shapes. */
export function layerToPoly(layer: Layer): Poly | null {
  const l = layer as unknown as Record<string, unknown>;
  const box = layerBox(l);
  switch (layer.type) {
    case 'rect':
    case 'image': {
      if (!box) return null;
      return [[[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]];
    }
    case 'circle':
    case 'ellipse':
      return box ? [ellipseRing(box)] : null;
    case 'polygon': {
      const pts = typeof l.points === 'string' ? polygonPointsRing(l.points) : null;
      if (pts) return [pts];
      const sides = typeof l.sides === 'number' ? l.sides : 0;
      return box && sides >= 3 ? [regularPolygonRing(box, sides)] : null;
    }
    case 'path': {
      const ring = typeof l.d === 'string' ? samplePathD(l.d) : null;
      return ring ? [ring] : null;
    }
    default:
      return null;
  }
}

function multiPolyToPathD(mp: MultiPoly): string {
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      const [x0, y0] = ring[0];
      let seg = `M${round(x0)} ${round(y0)}`;
      for (let i = 1; i < ring.length; i++) {
        // polygon-clipping repeats the first point as the last — skip it.
        if (i === ring.length - 1 && ring[i][0] === x0 && ring[i][1] === y0) break;
        seg += `L${round(ring[i][0])} ${round(ring[i][1])}`;
      }
      parts.push(seg + 'Z');
    }
  }
  return parts.join(' ');
}
function round(v: number): number { return Math.round(v * 100) / 100; }

/** Run a boolean on two layers and return the result path `d`, or null when a
 *  layer can't be flattened or the result is empty. Async: lazy-loads the clip lib. */
export async function booleanPathD(a: Layer, b: Layer, op: BoolOp): Promise<string | null> {
  const pa = layerToPoly(a), pb = layerToPoly(b);
  if (!pa || !pb) return null;
  const pc = await import('polygon-clipping');
  const A = [pa] as unknown as Parameters<typeof pc.union>[0];
  const B = [pb] as unknown as Parameters<typeof pc.union>[1];
  let res: MultiPoly;
  switch (op) {
    case 'union':     res = pc.union(A, B) as unknown as MultiPoly; break;
    case 'intersect': res = pc.intersection(A, B) as unknown as MultiPoly; break;
    case 'subtract':  res = pc.difference(A, B) as unknown as MultiPoly; break;
    case 'exclude':   res = pc.xor(A, B) as unknown as MultiPoly; break;
    default: return null;
  }
  if (!res || res.length === 0) return null;
  const d = multiPolyToPathD(res);
  return d || null;
}
