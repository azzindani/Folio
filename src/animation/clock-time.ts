/**
 * Moving a time through precomp clocks — retimeTrack's rule, as numbers.
 *
 * A clock `{start, speed}` puts local 0 at `start` on its parent's clock and
 * plays `speed` local ms per parent ms. Clocks nest; a stack is innermost first.
 * The timeline draws a precomp child's keyframe where it PLAYS (toSceneTime) and
 * turns a click on the ruler back into the keyframe time to write (fromSceneTime).
 */

import type { LayerClock } from './types';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const speedOf = (c: LayerClock): number => ((num(c.speed) ?? 1) > 0 ? (num(c.speed) ?? 1) : 1);

export function toSceneTime(local: number, clocks: LayerClock[]): number {
  let t = local;
  for (const c of clocks) t = (num(c.start) ?? 0) + t / speedOf(c);
  return t;
}

export function fromSceneTime(scene: number, clocks: LayerClock[]): number {
  let t = scene;
  for (let i = clocks.length - 1; i >= 0; i--) {
    const c = clocks[i];
    if (c) t = (t - (num(c.start) ?? 0)) * speedOf(c);
  }
  return t;
}
