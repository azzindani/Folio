/**
 * After Effects' loopOut, bounded: a track's tail repeated to a time, written
 * out as keyframes.
 *
 * playback.loop repeats the WHOLE track from its first key, so an entrance
 * that should land once and then bob, tick or walk had to be built by hand,
 * key by key. Here the part from key `from` to the last key repeats until
 * `until`:
 *   cycle     jump back to key `from` and play it again (a tick, a blink)
 *   pingpong  play it back the other way, each segment on its mirrored curve
 *   offset    each pass starts where the last ended, carrying its travel on
 *             (a walk, a conveyor, a counter that keeps climbing)
 * Only whole passes that end by `until` are written, so a scene is never made
 * longer. Every key it adds is marked `ambient` (the layer rests in a loop), and
 * the trailing run of ambient keys is what a re-run replaces.
 */

import type { Keyframe } from './types';
import { EASING_NAMES, parseCubicBezier } from './easing';

export type LoopMode = 'cycle' | 'pingpong' | 'offset';

/** Unrolled passes past this are cut — a loop is a rest, not the whole piece at 60 fps. */
export const MAX_PASSES = 240;
/** A cycle that does not end where it starts jumps back over this many ms. */
const JUMP_MS = 1;

const META = new Set(['t', 'easing', 'hold', 'ambient']);
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;

/** The curve that plays a segment backwards: ease-in going out is ease-out coming back. */
export function mirrorEasing(name: string | undefined): string | undefined {
  if (!name) return name;
  const b = parseCubicBezier(name);
  if (b) return `cubic-bezier(${r3(1 - b[2])}, ${r3(1 - b[3])}, ${r3(1 - b[0])}, ${r3(1 - b[1])})`;
  const swapped = name.startsWith('ease-in-out') ? name
    : name.startsWith('ease-in') ? name.replace('ease-in', 'ease-out')
      : name.startsWith('ease-out') ? name.replace('ease-out', 'ease-in') : name;
  return (EASING_NAMES as readonly string[]).includes(swapped) ? swapped : name;
}

/** The track without a previous loop-out: its trailing run of ambient keys. */
export function withoutLoop(keys: Keyframe[]): Keyframe[] {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let end = sorted.length;
  while (end > 1 && sorted[end - 1]?.ambient) end--;
  return sorted.slice(0, end);
}

/** A key's values only (no t / easing / hold / ambient). */
const valuesOf = (k: Keyframe): Record<string, unknown> =>
  Object.fromEntries(Object.entries(k).filter(([key]) => !META.has(key)));

/** Numeric travel of each channel from key a to key b. */
function travel(a: Keyframe, b: Keyframe): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(valuesOf(b))) {
    const from = a[k];
    if (typeof v === 'number' && typeof from === 'number') out[k] = v - from;
  }
  return out;
}

/** A key moved to time t, its numbers shifted by `add`, marked as part of the loop. */
function copyAt(k: Keyframe, t: number, add: Record<string, number>, easing: string | undefined): Keyframe {
  const vals = valuesOf(k);
  for (const [ch, d] of Object.entries(add)) { const v = vals[ch]; if (typeof v === 'number') vals[ch] = r3(v + d); }
  return { t: Math.round(t), ...vals, ...(easing ? { easing } : {}), ...(k.hold ? { hold: true } : {}), ambient: true } as Keyframe;
}

export interface LoopOut { keys: Keyframe[]; passes: number; period: number }

/**
 * `track` with keys `from`…last repeated in `mode` until local time `until`.
 * `trackEasing` is the playback easing a key without its own curve plays on —
 * needed to mirror it. The last key of the track takes the curve its loop
 * leaves on (the join into the first repeat), since the loop is now its next segment.
 */
export function loopOut(track: Keyframe[], mode: LoopMode, from: number, until: number, trackEasing?: string): LoopOut {
  const base = withoutLoop(track).map(k => ({ ...k }));
  const seg = base.slice(Math.max(0, Math.min(base.length - 2, Math.floor(from))));
  const first = seg[0], last = seg[seg.length - 1], n = seg.length;
  const span = first && last ? last.t - first.t : 0;
  // A pass that ends as it starts (a bob, a pulse) joins the next without a jump.
  const posed = (t: number): string => {
    // At a key's own time each channel holds the last value set to it.
    const pose: Record<string, unknown> = {};
    for (const k of seg) if (k.t <= t) Object.assign(pose, valuesOf(k));
    return JSON.stringify(Object.entries(pose).sort(([a], [b]) => a.localeCompare(b)));
  };
  const jump = mode === 'cycle' && !!first && !!last && posed(first.t) !== posed(last.t);
  const period = jump ? span + JUMP_MS : span;
  const passes = n < 2 || span <= 0 || !first || !last ? 0 : Math.min(MAX_PASSES, Math.floor((until - last.t) / period));
  if (passes < 1 || !first || !last) return { keys: base, passes: 0, period };

  const ease = (k: Keyframe | undefined): string | undefined => (typeof k?.easing === 'string' ? k.easing : trackEasing);
  const leaveOn = (e: string | undefined): void => {
    const k = base[base.length - 1];
    if (k && e !== undefined && e !== ease(k)) k.easing = e;
  };
  const per = mode === 'offset' ? travel(first, last) : {};
  const times = (p: number): Record<string, number> => Object.fromEntries(Object.entries(per).map(([ch, d]) => [ch, d * p]));
  const forward = (start: number, add: Record<string, number>, endEasing: string | undefined): void => {
    seg.slice(1).forEach((k, j) => base.push(copyAt(k, start + (k.t - first.t), add, j === n - 2 ? endEasing : k.easing)));
  };

  for (let p = 1; p <= passes; p++) {
    const start = last.t + (p - 1) * period;
    if (jump) {
      base.push(copyAt(first, start + JUMP_MS, {}, first.easing));
      forward(start + JUMP_MS, {}, last.easing);
    } else if (mode !== 'pingpong') {
      leaveOn(ease(first));
      forward(start, times(p), ease(first));
    } else if (p % 2 === 1) {
      // Back from the last key to key `from`: each segment on the mirror of the curve it had going forward.
      leaveOn(mirrorEasing(ease(seg[n - 2])));
      for (let j = n - 2; j >= 0; j--) {
        const k = seg[j];
        if (k) base.push(copyAt(k, start + (last.t - k.t), {}, j > 0 ? mirrorEasing(ease(seg[j - 1])) : ease(first)));
      }
    } else {
      forward(start, {}, mirrorEasing(ease(seg[n - 2])));
    }
  }
  return { keys: base, passes, period };
}
