// Sample a point (and heading) along an SVG path.
//
// `layer.motion_path` has been in the schema and the renderer all along — the
// SVG route emits <animateMotion> and the browser walks the curve. Nothing
// else could: the frame sampler and the GIF route only ever read
// `animation.keyframes`, so a design that travelled along a path in the editor
// sat perfectly still in every exported frame. docs/MOTION.md §5 records it as
// "rendered but not surfaced as an MCP op or sampled by the flipbook".
//
// Rather than reimplement bezier arc length analytically, flatten the path once
// into a polyline and build a cumulative-length table. Sampling is then a
// binary search plus a lerp, the heading is the direction of the segment the
// point lands on, and every curve type reduces to the same code. The error is
// bounded by FLATTEN_STEPS and is far below a pixel at the sizes designs use.
export interface PathPoint { x: number; y: number; angle: number }

const FLATTEN_STEPS = 24;

type Pt = { x: number; y: number };

/** Every command SVG allows in a `d`, minus the elliptical arc — see parsePath. */
const CMD_RE = /([MmLlHhVvCcSsQqTtZz])([^MmLlHhVvCcSsQqTtZzAa]*)/g;

function nums(s: string): number[] {
  return (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(n => Number.isFinite(n));
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function quad(p0: Pt, p1: Pt, p2: Pt, u: number): Pt {
  const v = 1 - u;
  return { x: v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x, y: v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y };
}

/**
 * Flatten a path `d` to a polyline.
 *
 * Returns null for anything unparseable and for `A`/`a`: an elliptical arc
 * needs its own solver, and silently dropping the command would move the layer
 * along a DIFFERENT path than the one the browser draws — the two routes have
 * to agree, so refusing loudly beats disagreeing quietly.
 */
export function flattenPath(d: string): Pt[] | null {
  if (/[Aa]/.test(d)) return null;
  const pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastCtrl: Pt | null = null;
  let sawMove = false;

  const push = (p: Pt): void => { pts.push(p); cur = p; };
  const curve = (fn: (u: number) => Pt): void => {
    for (let i = 1; i <= FLATTEN_STEPS; i++) pts.push(fn(i / FLATTEN_STEPS));
    cur = pts[pts.length - 1] ?? cur;
  };

  for (const m of d.matchAll(CMD_RE)) {
    const cmd = m[1] ?? '';
    const rel = cmd === cmd.toLowerCase();
    const n = nums(m[2] ?? '');
    const ax = (v: number): number => (rel ? cur.x + v : v);
    const ay = (v: number): number => (rel ? cur.y + v : v);

    switch (cmd.toUpperCase()) {
      case 'M': {
        for (let i = 0; i + 1 < n.length; i += 2) {
          const p = { x: ax(n[i] as number), y: ay(n[i + 1] as number) };
          if (i === 0) { push(p); start = p; sawMove = true; } else push(p);
        }
        lastCtrl = null;
        break;
      }
      case 'L':
        for (let i = 0; i + 1 < n.length; i += 2) push({ x: ax(n[i] as number), y: ay(n[i + 1] as number) });
        lastCtrl = null;
        break;
      case 'H': for (const v of n) push({ x: ax(v), y: cur.y }); lastCtrl = null; break;
      case 'V': for (const v of n) push({ x: cur.x, y: ay(v) }); lastCtrl = null; break;
      case 'C':
        for (let i = 0; i + 5 < n.length; i += 6) {
          const p0 = cur;
          const c1 = { x: ax(n[i] as number), y: ay(n[i + 1] as number) };
          const c2 = { x: ax(n[i + 2] as number), y: ay(n[i + 3] as number) };
          const p3 = { x: ax(n[i + 4] as number), y: ay(n[i + 5] as number) };
          curve(u => cubic(p0, c1, c2, p3, u));
          lastCtrl = c2;
        }
        break;
      case 'S':
        for (let i = 0; i + 3 < n.length; i += 4) {
          const p0 = cur;
          const c1: Pt = lastCtrl ? { x: 2 * p0.x - lastCtrl.x, y: 2 * p0.y - lastCtrl.y } : p0;
          const c2 = { x: ax(n[i] as number), y: ay(n[i + 1] as number) };
          const p3 = { x: ax(n[i + 2] as number), y: ay(n[i + 3] as number) };
          curve(u => cubic(p0, c1, c2, p3, u));
          lastCtrl = c2;
        }
        break;
      case 'Q':
        for (let i = 0; i + 3 < n.length; i += 4) {
          const p0 = cur;
          const c = { x: ax(n[i] as number), y: ay(n[i + 1] as number) };
          const p2 = { x: ax(n[i + 2] as number), y: ay(n[i + 3] as number) };
          curve(u => quad(p0, c, p2, u));
          lastCtrl = c;
        }
        break;
      case 'T':
        for (let i = 0; i + 1 < n.length; i += 2) {
          const p0 = cur;
          const c: Pt = lastCtrl ? { x: 2 * p0.x - lastCtrl.x, y: 2 * p0.y - lastCtrl.y } : p0;
          const p2 = { x: ax(n[i] as number), y: ay(n[i + 1] as number) };
          curve(u => quad(p0, c, p2, u));
          lastCtrl = c;
        }
        break;
      case 'Z': push({ ...start }); lastCtrl = null; break;
      default: return null;
    }
  }
  if (!sawMove || pts.length < 2) return null;
  return pts;
}

export interface SampledPath { at(u: number): PathPoint; length: number }

/** Cumulative-length table over the flattened polyline. */
export function samplePath(d: string): SampledPath | null {
  const pts = flattenPath(d);
  if (!pts) return null;
  const acc: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt, b = pts[i] as Pt;
    acc.push((acc[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = acc[acc.length - 1] as number;

  const at = (u: number): PathPoint => {
    const first = pts[0] as Pt;
    if (total <= 0) return { x: first.x, y: first.y, angle: 0 };
    const target = Math.min(Math.max(u, 0), 1) * total;
    let lo = 0, hi = acc.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if ((acc[mid] as number) <= target) lo = mid; else hi = mid; }
    const a = pts[lo] as Pt, b = pts[hi] as Pt;
    const segLen = (acc[hi] as number) - (acc[lo] as number);
    const f = segLen > 0 ? (target - (acc[lo] as number)) / segLen : 0;
    return {
      x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  };
  return { at, length: total };
}
