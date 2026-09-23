import { describe, it, expect } from 'vitest';
import type { Keyframe } from './types';
import { loopOut, mirrorEasing, withoutLoop } from './loop-out';
import { interpolateKeyframes } from './keyframe-engine';

/** An entrance (0→400: fade and rise) then a bob (400→1000: down and back). */
const track = (): Keyframe[] => [
  { t: 0, opacity: 0, y: 40, easing: 'ease-out' },
  { t: 400, opacity: 1, y: 0, easing: 'ease-in-out' },
  { t: 700, y: 12, easing: 'ease-in-out' },
  { t: 1000, y: 0 },
];
const at = (keys: Keyframe[], t: number, ch: string): number => Number(interpolateKeyframes(keys, t, 'linear')[ch]);

describe('loopOut', () => {
  it('cycles the bob after the entrance, whole passes only, never past the scene end', () => {
    const { keys, passes, period } = loopOut(track(), 'cycle', 1, 3000);
    // The bob ends where it starts, so passes join without a jump.
    expect(period).toBe(600);
    expect(passes).toBe(3);
    expect(Math.max(...keys.map(k => k.t))).toBeLessThanOrEqual(3000);
    // The entrance plays once; each pass bobs like the first.
    expect(at(keys, 200, 'opacity')).toBeLessThan(1);
    expect(at(keys, 700, 'y')).toBeCloseTo(12, 5);
    expect(at(keys, 700 + period, 'y')).toBeCloseTo(12, 5);
    expect(at(keys, 700 + 2 * period, 'y')).toBeCloseTo(12, 5);
    // Opacity is not part of the bob: unset in the repeats exactly as between the bob's own keys.
    expect(interpolateKeyframes(keys, 2000, 'linear')['opacity']).toBeUndefined();
    expect(interpolateKeyframes(track(), 800, 'linear')['opacity']).toBeUndefined();
    expect(keys.filter(k => k.ambient)).toHaveLength(6);
    // A pass that does not end where it starts jumps back over 1 ms.
    const tick = loopOut([{ t: 0, rotation: 0 }, { t: 500, rotation: 90 }], 'cycle', 0, 2000);
    expect(tick.period).toBe(501);
    expect(tick.keys.slice(2, 4).map(k => [k.t, k.rotation])).toEqual([[501, 0], [1001, 90]]);
  });

  it('pingpongs back on the mirrored curve and forward on the original', () => {
    const keys = loopOut([{ t: 0, x: 0, easing: 'ease-in' }, { t: 500, x: 100 }], 'pingpong', 0, 2000).keys;
    expect(keys.map(k => [k.t, k.x])).toEqual([[0, 0], [500, 100], [1000, 0], [1500, 100], [2000, 0]]);
    expect(keys[1]?.easing).toBe('ease-out');   // back: the mirror of ease-in
    expect(keys[2]?.easing).toBe('ease-in');    // forward again
    // Going back on ease-out retraces the forward path: the position at 250 ms back equals the position at 250 ms forward.
    expect(at(keys, 750, 'x')).toBeCloseTo(at(keys, 250, 'x'), 5);
  });

  it('offsets each pass by the travel of the last, so a walk keeps going', () => {
    const keys = loopOut([{ t: 0, x: 0 }, { t: 300, x: 30, y: -8 }, { t: 600, x: 60, y: 0 }], 'offset', 0, 1800).keys;
    expect(keys.filter(k => k.t % 600 === 0).map(k => k.x)).toEqual([0, 60, 120, 180]);
    expect(at(keys, 900, 'y')).toBeCloseTo(-8, 5);   // the hop repeats; y has no travel to carry
  });

  it('replaces its own loop when run again, and writes nothing when no pass fits', () => {
    const once = loopOut(track(), 'cycle', 1, 3000).keys;
    expect(withoutLoop(once)).toEqual(track().map(k => expect.objectContaining({ t: k.t })));
    const again = loopOut(once, 'pingpong', 1, 3000);
    expect(again.keys.filter(k => k.ambient).every(k => k.t > 1000)).toBe(true);
    expect(loopOut(track(), 'cycle', 1, 1200).passes).toBe(0);
  });
});

describe('mirrorEasing', () => {
  it('swaps in and out, mirrors a bezier, and keeps a symmetric curve', () => {
    expect(mirrorEasing('ease-in-cubic')).toBe('ease-out-cubic');
    expect(mirrorEasing('ease-out-back')).toBe('ease-in-back');
    expect(mirrorEasing('ease-in-out')).toBe('ease-in-out');
    expect(mirrorEasing('cubic-bezier(0.1, 0.7, 0.3, 1)')).toBe('cubic-bezier(0.7, 0, 0.9, 0.3)');
    expect(mirrorEasing('linear')).toBe('linear');
  });
});
