/**
 * What one keyframe segment changes, read the way the sampler reads it
 * (keyframe-engine.ts interpolateKeyframes): a channel the earlier frame names
 * and the later one does not HOLDS; a channel only the later frame names
 * tweens from the last value set before it. Comparing the two frames as
 * objects said a merged exit frame carrying opacity alone moved `y` — retime
 * called a held line "stretched" at the very rest a model picked, and the
 * review called the shot "never still" (benchmark r5).
 */

import type { Keyframe } from './types';

const META = new Set(['t', 'easing', 'hold', 'ambient']);

/** A channel a segment changes: its value where the segment starts, and where it ends. */
export interface ChannelChange { key: string; from: unknown; to: unknown }

const same = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9
    : typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase()
      : a === b;

/** The last value `key` was set to at or before frame i. */
function lastSet(sorted: Keyframe[], i: number, key: string): unknown {
  for (let j = i; j >= 0; j--) {
    const v = (sorted[j] as unknown as Record<string, unknown> | undefined)?.[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * The channels that change between frame i and frame i+1 of a time-sorted
 * track. A channel never set before the later frame jumps to it rather than
 * moving, so it is not a change over the segment.
 */
export function changedChannels(sorted: Keyframe[], i: number): ChannelChange[] {
  const q = sorted[i + 1] as unknown as Record<string, unknown> | undefined;
  if (!q || !sorted[i]) return [];
  const out: ChannelChange[] = [];
  for (const [key, to] of Object.entries(q)) {
    if (META.has(key) || to === undefined) continue;
    const from = lastSet(sorted, i, key);
    if (from !== undefined && !same(from, to)) out.push({ key, from, to });
  }
  return out;
}
