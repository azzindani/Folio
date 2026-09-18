/**
 * Path easing, shared by the SVG route and the flipbook — kept apart from
 * motion-path.ts so the renderer can use it without the path flattener.
 */

import { resolveEasing } from './easing';

/**
 * The curve a layer travels its path on, as samples both players read.
 *
 * The SVG route drove <animateMotion> with a hard-coded ease-in-out spline and
 * ignored `easing`; the flipbook walked the path at constant speed. So the same
 * path arrived at mid-point at different moments in the SVG and the GIF. Now
 * the easing is sampled once: SMIL gets the samples as keyTimes/keyPoints
 * (calcMode linear), the flipbook interpolates the same samples. A curve that
 * overshoots (back, elastic) is clamped — keyPoints must stay within 0–1.
 */
export const PATH_EASE_STEPS = 24;
const EASE_CACHE = new Map<string, { times: number[]; points: number[] }>();

export function pathEase(easing: string | undefined): { times: number[]; points: number[] } {
  const key = easing ?? '';
  const hit = EASE_CACHE.get(key);
  if (hit) return hit;
  const fn = resolveEasing(easing);
  const times: number[] = [], points: number[] = [];
  for (let i = 0; i <= PATH_EASE_STEPS; i++) {
    const x = i / PATH_EASE_STEPS;
    times.push(Number(x.toFixed(4)));
    points.push(Number(Math.min(1, Math.max(0, fn(x))).toFixed(4)));
  }
  const out = { times, points };
  EASE_CACHE.set(key, out);
  return out;
}

/** How far along the path the layer is at `x` (0–1) of one pass — the samples above, interpolated. */
export function pathProgress(easing: string | undefined, x: number): number {
  const { points } = pathEase(easing);
  const c = Math.min(1, Math.max(0, x)) * PATH_EASE_STEPS;
  const i = Math.min(PATH_EASE_STEPS - 1, Math.floor(c));
  const a = points[i] ?? 0, b = points[i + 1] ?? 1;
  return a + (b - a) * (c - i);
}


/** When a path travels. `period`/`offset` come from a looping precomp: each pass waits `offset`, travels, rests at the end until `period`. */
export interface PathTiming { duration?: number; delay?: number; loop?: boolean; easing?: string; period?: number; offset?: number }

/** One pass of a looping path: its period, the wait before it sets off, and how much of the travel fits before the pass ends. */
function passOf(mp: PathTiming, dur: number): { period: number; offset: number; reach: number } {
  const period = Math.max(1, mp.period ?? dur);
  const offset = Math.min(Math.max(0, mp.offset ?? 0), period);
  return { period, offset, reach: Math.min(1, (period - offset) / dur) };
}

/**
 * How far along its path (0–1, eased) a layer is at scene time `t`, or null
 * before it sets off — SMIL applies no motion before `begin`. The flipbook
 * walks this; pathSMIL writes the same curve for the browser.
 */
export function pathAt(mp: PathTiming, t: number): number | null {
  const dur = mp.duration ?? 2000;
  const local = t - (mp.delay ?? 0);
  if (dur <= 0 || local < 0) return null;
  if (!mp.loop) return pathProgress(mp.easing, local / dur);
  const { period, offset } = passOf(mp, dur);
  const x = (local % period) - offset;
  return pathProgress(mp.easing, x <= 0 ? 0 : Math.min(1, x / dur));
}

/**
 * The <animateMotion> timing for a path. A plain pass is the eased samples
 * over `dur`; a pass inside a looping precomp spans its period — held at the
 * start for `offset`, the travel on the SAME easing samples (cut where the
 * period ends), held at the end — so the browser and the flipbook agree.
 */
export function pathSMIL(mp: PathTiming): { begin: number; dur: number; repeat: boolean; keyTimes: string; keyPoints: string } {
  const dur = mp.duration ?? 2000;
  const ease = pathEase(mp.easing);
  const begin = Math.max(0, mp.delay ?? 0);
  if (!mp.loop || (mp.period === undefined && !mp.offset)) {
    return { begin, dur, repeat: mp.loop === true, keyTimes: ease.times.join(';'), keyPoints: ease.points.join(';') };
  }
  const { period, offset, reach } = passOf(mp, dur);
  const pts: Array<[number, number]> = [[0, 0]];
  const push = (tau: number, u: number): void => {
    const k = Number((tau / period).toFixed(5));
    const last = pts[pts.length - 1];
    if (last && k <= last[0]) { if (k === last[0]) last[1] = u; return; }
    pts.push([k, Number(u.toFixed(4))]);
  };
  for (let i = 0; i <= PATH_EASE_STEPS && i / PATH_EASE_STEPS <= reach; i++) push(offset + (i / PATH_EASE_STEPS) * dur, ease.points[i] ?? 1);
  push(offset + reach * dur, pathProgress(mp.easing, reach));
  if ((pts[pts.length - 1]?.[0] ?? 1) < 1) push(period, pathProgress(mp.easing, reach));
  return { begin, dur: period, repeat: true, keyTimes: pts.map(p => p[0]).join(';'), keyPoints: pts.map(p => p[1]).join(';') };
}
