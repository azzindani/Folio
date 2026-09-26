/**
 * In and out points — a layer that exists only for part of the scene.
 *
 * After Effects draws every layer as a bar on the timeline: before its in
 * point and after its out point the layer is not there at all. A continuous
 * 30 s composition leans on that: forty layers take turns on one canvas, and
 * each is present only while its part of the story plays. Both players read the
 * same window from here — the flipbook hides the layer (and the raster cull
 * then skips it outright), the CSS route animates `visibility` in steps.
 */

import type { Layer } from '../schema/types';

/** When a layer exists on the scene clock: from `in` (inclusive) to `out` (exclusive). */
export interface LifeWindow { in: number; out: number }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const fmt = (v: number): string => String(Number(v.toFixed(3)));

/** The layer's own window, or null when it has neither point (alive the whole scene). */
export function windowOf(layer: Layer): LifeWindow | null {
  const o = layer as unknown as Record<string, unknown>;
  const a = num(o['in']), b = num(o['out']);
  if (a === undefined && b === undefined) return null;
  return { in: Math.max(0, a ?? 0), out: b ?? Infinity };
}

/** A window inside another: a child cannot outlive the group it sits in. */
export function intersectWindows(outer: LifeWindow | null, inner: LifeWindow | null): LifeWindow | null {
  if (!outer) return inner;
  if (!inner) return outer;
  return { in: Math.max(outer.in, inner.in), out: Math.min(outer.out, inner.out) };
}

/** Below this a keyed opacity leaves the layer unseen. */
const UNSEEN = 0.05;

/**
 * When a layer can be SEEN: its in/out window, narrowed by a one-shot track that
 * fades it in or out (a compiled motion rule is such a track). Generous at the
 * edges — from the key its fade starts at to the key it is gone at — so two layers
 * are only called apart when they truly never share the screen. Found on the
 * one-shot proof piece: a cover headline and the payoff that replaces it were
 * reported as a pile-up, though no frame holds both.
 */
export function seenWindow(layer: Layer): LifeWindow | null {
  const span = windowOf(layer);
  const a = (layer as { animation?: { keyframes?: Array<{ t: number; opacity?: unknown }>; playback?: { loop?: boolean; delay?: number } } }).animation;
  const keys = [...(a?.keyframes ?? [])].sort((p, q) => p.t - q.t);
  if (!keys.length || a?.playback?.loop || !keys.some(k => typeof k.opacity === 'number')) return span;
  const delay = a?.playback?.delay ?? 0;
  let op = 1;
  const pts = keys.map(k => { if (typeof k.opacity === 'number') op = k.opacity; return { t: k.t + delay, seen: op > UNSEEN }; });
  const first = pts.findIndex(p => p.seen);
  if (first < 0) return { in: 0, out: 0 };
  let last = pts.length - 1;
  while (last > 0 && !pts[last]?.seen) last--;
  const from = first === 0 ? 0 : pts[first - 1]?.t ?? 0;
  const until = last === pts.length - 1 ? Infinity : pts[last + 1]?.t ?? Infinity;
  return intersectWindows(span, { in: Math.max(0, from), out: until });
}

/** Every layer's seen window, a child's narrowed by the groups it sits in. */
export function seenWindows(layers: Layer[], outer: LifeWindow | null = null, out = new Map<string, LifeWindow | null>()): Map<string, LifeWindow | null> {
  for (const l of layers) {
    const w = intersectWindows(outer, seenWindow(l));
    out.set(l.id, w);
    const kids = (l as { layers?: unknown }).layers;
    if (Array.isArray(kids)) seenWindows(kids as Layer[], w, out);
  }
  return out;
}

/** Whether two windows share any moment (null = the whole scene). */
export function overlapInTime(p: LifeWindow | null | undefined, q: LifeWindow | null | undefined): boolean {
  const w = intersectWindows(p ?? null, q ?? null);
  return !w || w.in < w.out;
}

/** True when the layer exists at scene time t. */
export function aliveAt(layer: Layer, t: number): boolean {
  const w = windowOf(layer);
  return !w || (t >= w.in && t < w.out);
}

/** The latest point a window names — how long a scene must run to show it. */
export function windowEnd(w: LifeWindow): number {
  return Number.isFinite(w.out) ? w.out : w.in;
}

/**
 * The CSS that shows a layer only inside its window: `@keyframes` stepping
 * `visibility`, and the animation entry that plays it.
 *
 * `visibility` interpolates as a step that turns visible as soon as a segment
 * leaves a hidden end, so every segment runs `step-end`: the value holds until
 * the segment's last instant. `both` fill keeps the first step before the
 * animation starts and the last one after it ends.
 */
export function lifeCSS(layerId: string, w: LifeWindow): { keyframes: string; animation: string } | null {
  const closes = Number.isFinite(w.out);
  if (w.in <= 0 && !closes) return null;
  if (closes && w.out <= w.in) {
    // An empty window: never on screen.
    return { keyframes: `@keyframes life-${layerId} { 0%, 100% { visibility: hidden; } }`, animation: `life-${layerId} 1ms linear 0ms 1 normal both` };
  }
  const span = closes ? w.out : w.in + 1;
  const pct = (ms: number): string => fmt(Math.min(100, (ms / span) * 100));
  const steps: string[] = [];
  if (w.in > 0) steps.push(`0% { visibility: hidden; animation-timing-function: step-end; }`);
  steps.push(`${pct(w.in)}% { visibility: visible; animation-timing-function: step-end; }`);
  steps.push(closes ? `100% { visibility: hidden; }` : `100% { visibility: visible; }`);
  return {
    keyframes: `@keyframes life-${layerId} { ${steps.join(' ')} }`,
    animation: `life-${layerId} ${fmt(span)}ms linear 0ms 1 normal both`,
  };
}
