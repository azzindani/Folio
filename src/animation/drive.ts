/**
 * One channel driven by another — After Effects' linear expression, bounded:
 * `target = add + factor × source`, written out as keys.
 *
 * Exact, not sampled. The sampler reads a channel off the keys that name it:
 * a key that does not name it holds the last value to its own time, then the
 * next key that does tweens on that key's curve. So the driven channel is put
 * on the SAME key structure as the source — every source key at its time with
 * its easing and hold, naming the driven channel exactly where the source
 * names its own — and plays the source's curve, scaled, frame for frame.
 */

import type { Keyframe } from './types';

/** How a channel is driven: `add + factor × from` (lag is applied by the caller, on the delay). */
export interface DriveMap { channel: string; from: string; factor: number; add?: number }

const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;

/**
 * Write `m.channel` onto `keys` themselves, from their own `m.from` — a layer
 * driving itself (a wheel's x turning it). Keys that do not name `from` do not
 * name the driven channel either, so it holds and tweens exactly as `from` does.
 * `rest` is subtracted first (the source's rest value, for x/y under origin 'first').
 */
export function driveOwn(keys: Keyframe[], m: DriveMap, rest = 0): Keyframe[] {
  return keys.map(k => {
    const { [m.channel]: _old, ...keep } = k;
    void _old;
    const v = k[m.from];
    return (typeof v === 'number' ? { ...keep, [m.channel]: r3((m.add ?? 0) + m.factor * (v - rest)) } : keep) as Keyframe;
  });
}

/**
 * A track for another layer: the source's whole key structure — times, curves,
 * holds — naming only the driven channel. A key that names nothing is kept: it
 * holds the first key's time (so the track starts when the source does) and
 * the curve structure the driven channel plays on. `lag` is the caller's, on
 * the track's delay, so the keys keep the source's times.
 */
export function driveTrack(source: Keyframe[], m: DriveMap, rest = 0): Keyframe[] {
  return [...source].sort((a, b) => a.t - b.t).map((k): Keyframe => {
    const v = k[m.from];
    return {
      t: k.t,
      ...(typeof v === 'number' ? { [m.channel]: r3((m.add ?? 0) + m.factor * (v - rest)) } : {}),
      ...(k.easing ? { easing: k.easing } : {}), ...(k.hold ? { hold: true } : {}),
    } as Keyframe;
  });
}

/** Degrees a wheel of this diameter turns per px it rolls. */
export const rollFactor = (diameter: number): number => (diameter > 0 ? 360 / (Math.PI * diameter) : 0);
