// Illustrator-side path operations: blend, outline-stroke, offset.
//
// docs/MOTION.md §5: "boolean ops and shape paths exist in the renderer; offset
// path, outline stroke, blend/morph between shapes are not exposed." The
// boolean ops that DO exist live in src/editor/boolean-ops.ts and sample `path`
// layers through an off-DOM SVG element, so they only run in a browser. These
// are pure and server-side, built on the same flattener the motion sampler uses.
//
// Everything reduces to two primitives already on hand: flatten a path to a
// polyline, and run polygon booleans on rings. An offset is the union of a quad
// per segment plus a disc per joint — the standard construction, and robust on
// concave shapes where naive per-vertex normal offsetting self-intersects.
import { flattenPath } from '../animation/motion-path';

export type Pt = [number, number];
type Ring = Pt[];
type MultiPoly = Ring[][];

const JOINT_STEPS = 12;
// polygon-clipping is a sweep-line algorithm and is sensitive to near-duplicate
// coordinates: an offset built from many discs feeds it points that differ in
// the 15th decimal, and it aborts with "Unable to find segment … in SweepLine
// tree". Snapping to a 0.01px grid removes the near-degeneracy without moving
// anything a design could see.
const GRID = 100;
const snap = (v: number): number => Math.round(v * GRID) / GRID;
const snapRing = (r: Ring): Ring => r.map(p => [snap(p[0]), snap(p[1])] as Pt);

function len(a: Pt, b: Pt): number { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

export function ringToD(ring: Ring): string {
  if (ring.length === 0) return '';
  const head = `M ${ring[0]?.[0].toFixed(2)} ${ring[0]?.[1].toFixed(2)}`;
  return `${head} ${ring.slice(1).map(p => `L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')} Z`;
}

export function multiPolyToD(mp: MultiPoly): string {
  return mp.flatMap(poly => poly.map(ringToD)).filter(Boolean).join(' ');
}

/**
 * Resample a polyline to exactly `n` points spaced by ARC LENGTH.
 *
 * Blending needs both shapes to have the same point count and a comparable
 * parameterisation. Matching raw vertices instead would pair a dense corner on
 * one shape against a long flat edge on the other and the intermediate frames
 * would visibly crumple.
 */
export function resample(pts: Ring, n: number): Ring {
  if (pts.length < 2 || n < 2) return pts.slice(0, n);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push((acc[i - 1] as number) + len(pts[i - 1] as Pt, pts[i] as Pt));
  const total = acc[acc.length - 1] as number;
  if (total <= 0) return new Array<Pt>(n).fill(pts[0] as Pt);
  const out: Ring = [];
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    let lo = 0, hi = acc.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if ((acc[mid] as number) <= target) lo = mid; else hi = mid; }
    const a = pts[lo] as Pt, b = pts[hi] as Pt;
    const seg = (acc[hi] as number) - (acc[lo] as number);
    const f = seg > 0 ? (target - (acc[lo] as number)) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** Rotate `b`'s start point to whichever alignment sits closest to `a`.
 *  Without it two shapes drawn from different corners twist through the blend. */
export function alignStart(a: Ring, b: Ring): Ring {
  let best = 0, bestCost = Infinity;
  for (let s = 0; s < b.length; s++) {
    let cost = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i] as Pt, q = b[(i + s) % b.length] as Pt;
      cost += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (cost >= bestCost) break;
    }
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  return b.map((_, i) => b[(i + best) % b.length] as Pt);
}

/**
 * `steps` intermediate shapes between two paths — Illustrator's Blend.
 *
 * Returns ONLY the in-between shapes; the caller already has the endpoints.
 */
export function blendPaths(dA: string, dB: string, steps: number, points = 96): string[] | null {
  const a = flattenPath(dA), b = flattenPath(dB);
  if (!a || !b) return null;
  const ra = resample(a.map(p => [p.x, p.y] as Pt), points);
  const rb = alignStart(ra, resample(b.map(p => [p.x, p.y] as Pt), points));
  const out: string[] = [];
  for (let s = 1; s <= steps; s++) {
    const u = s / (steps + 1);
    out.push(ringToD(ra.map((p, i) => {
      const q = rb[i] as Pt;
      return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u] as Pt;
    })));
  }
  return out;
}

/** A disc, as a ring — the round joint between two offset segments. */
function disc(c: Pt, r: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < JOINT_STEPS; i++) {
    const t = (i / JOINT_STEPS) * Math.PI * 2;
    ring.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]);
  }
  return ring;
}

/** The region a stroke of `width` covers along `d` — quads plus round joints. */
function strokeRegion(pts: Ring, width: number): MultiPoly {
  const r = width / 2;
  const parts: MultiPoly = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt, b = pts[i] as Pt;
    const L = len(a, b);
    if (L === 0) continue;
    const nx = (-(b[1] - a[1]) / L) * r, ny = ((b[0] - a[0]) / L) * r;
    parts.push([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]]);
  }
  for (const p of pts) parts.push([disc(p, r)]);
  return parts.map(poly => poly.map(snapRing));
}

/**
 * Union many pieces one at a time, tolerating a failure on any single piece.
 *
 * All-at-once is faster but all-or-nothing, and polygon-clipping can still
 * abort on a pathological pair even after snapping. Dropping one disc from an
 * outline is invisible; losing the whole operation to a library exception is
 * not — and a crash inside a tool call reads to the caller as the engine being
 * broken rather than one shape being awkward.
 */
function unionAll(pc: PC, parts: MultiPoly): MultiPoly | null {
  let acc: MultiPoly | null = null;
  for (const piece of parts) {
    const one = [piece] as unknown as MultiPoly;
    if (!acc) { acc = one; continue; }
    try { acc = pc.union(acc, one); } catch { /* skip this piece */ }
  }
  return acc;
}

type PC = {
  union: (a: MultiPoly, ...rest: MultiPoly[]) => MultiPoly;
  difference: (a: MultiPoly, b: MultiPoly) => MultiPoly;
};

/** Turn a stroked path into a FILLED shape covering the same ink. */
export async function outlineStroke(d: string, width: number): Promise<string | null> {
  const pts = flattenPath(d);
  if (!pts || width <= 0) return null;
  const pc = (await import('polygon-clipping')) as unknown as PC;
  const parts = strokeRegion(pts.map(p => [p.x, p.y] as Pt), width);
  if (parts.length === 0) return null;
  const merged = unionAll(pc, parts);
  return merged ? (multiPolyToD(merged) || null) : null;
}

/** Grow (delta > 0) or shrink (delta < 0) a CLOSED shape by `delta` px. */
export async function offsetPath(d: string, delta: number): Promise<string | null> {
  const pts = flattenPath(d);
  if (!pts || delta === 0) return null;
  const pc = (await import('polygon-clipping')) as unknown as PC;
  const ring = snapRing(pts.map(p => [p.x, p.y] as Pt));
  const body: MultiPoly = [[ring]];
  const bandMp = unionAll(pc, strokeRegion(ring, Math.abs(delta) * 2));
  if (!bandMp) return null;
  try {
    const out = delta > 0 ? pc.union(body, bandMp) : pc.difference(body, bandMp);
    return multiPolyToD(out) || null;
  } catch { return null; }        // awkward geometry, not a broken engine
}
