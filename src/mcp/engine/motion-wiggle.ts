/**
 * Wiggle — After Effects' wiggle(freq, amp) as ordinary keyframes.
 *
 * Seeded noise, never Math.random: the same layer wiggles the same way on
 * every call and in every export, GIF and SVG alike. One random target per
 * step (`frequency` per second), eased in and out between them, and the last
 * frame repeats the first so the loop closes without a jump.
 */

import * as crypto from 'crypto';
import type { Keyframe } from '../../animation/types';

/** How far each channel may stray: px for x/y, degrees for rotation, a ratio for scale (0.05 = ±5%). */
export interface WiggleAmplitude { x?: number; y?: number; rotation?: number; scale?: number }

const CHANNELS = ['x', 'y', 'rotation', 'scale'] as const;

/** A number in [-1, 1] from a seed — the same on every call and every machine. */
function noise(seed: string): number {
  const h = crypto.createHash('sha1').update(seed).digest();
  return (h.readUInt32BE(0) / 0xffffffff) * 2 - 1;
}

export function wiggleKeyframes(seed: string, amp: WiggleAmplitude, frequency: number, durationMs: number): Keyframe[] {
  const steps = Math.max(2, Math.round((durationMs / 1000) * Math.max(0.1, frequency)));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    // The closing frame reuses step 0's targets, so a looping wiggle never snaps.
    const k = i === steps ? 0 : i;
    const kf: Keyframe = { t: Math.round((durationMs * i) / steps), easing: 'ease-in-out' };
    for (const ch of CHANNELS) {
      const a = amp[ch];
      if (typeof a !== 'number' || a === 0) continue;
      const v = noise(`${seed}#${ch}#${k}`) * Math.abs(a);
      kf[ch] = ch === 'scale' ? Number((1 + v).toFixed(4)) : Number(v.toFixed(2));
    }
    frames.push(kf);
  }
  return frames;
}
