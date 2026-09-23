import { describe, it, expect } from 'vitest';
import type { Keyframe } from './types';
import { driveOwn, driveTrack, rollFactor } from './drive';
import { interpolateKeyframes } from './keyframe-engine';

const at = (keys: Keyframe[], t: number, ch: string): number | undefined => {
  const v = interpolateKeyframes(keys, t, 'ease-in-out')[ch];
  return typeof v === 'number' ? v : undefined;
};
/** A roll with a pause in the middle (the 600 key names only opacity, so x holds, then tweens on its curve). */
const roll: Keyframe[] = [
  { t: 0, x: 0, easing: 'ease-in' },
  { t: 400, x: 200, easing: 'ease-out-cubic' },
  { t: 600, opacity: 0.8, easing: 'ease-in-out' },
  { t: 1200, x: 500 },
];

describe('drive', () => {
  it('turns a wheel by its own roll, frame for frame, holding where its roll holds', () => {
    const f = rollFactor(100);
    expect(f).toBeCloseTo(360 / (Math.PI * 100), 9);
    const keys = driveOwn(roll, { channel: 'rotation', from: 'x', factor: f });
    for (let t = 0; t <= 1300; t += 50) {
      const x = at(keys, t, 'x');
      const r = at(keys, t, 'rotation');
      if (x === undefined) expect(r).toBeUndefined();
      else expect(r ?? NaN).toBeCloseTo(f * x, 1);
    }
    // Run again with another factor: the old rotation is replaced, not added to.
    expect(driveOwn(keys, { channel: 'rotation', from: 'x', factor: 1 }).map(k => k['rotation'])).toEqual([0, 200, undefined, 500]);
  });

  it('gives another layer a track that plays the source channel scaled and shifted, on the source\'s curves', () => {
    const track = driveTrack(roll, { channel: 'y', from: 'x', factor: -0.1, add: 5 });
    expect(track.map(k => k.t)).toEqual([0, 400, 600, 1200]);
    expect(track[2]).toEqual({ t: 600, easing: 'ease-in-out' });
    for (let t = 0; t <= 1200; t += 40) expect(at(track, t, 'y') ?? NaN).toBeCloseTo(5 - 0.1 * (at(roll, t, 'x') ?? NaN), 2);
  });

  it('measures x/y from the source\'s rest when asked', () => {
    const k = driveOwn([{ t: 0, x: 100 }, { t: 500, x: 160 }], { channel: 'rotation', from: 'x', factor: 2 }, 100);
    expect(k.map(v => v['rotation'])).toEqual([0, 120]);
  });
});
