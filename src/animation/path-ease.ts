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

