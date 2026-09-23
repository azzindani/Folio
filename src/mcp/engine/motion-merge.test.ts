import { describe, it, expect } from 'vitest';
import { mergeFragment, MergeError, type Fragment } from './motion-merge';
import type { AnimationSpec } from '../../animation/types';

const frag = (delay: number, from: Record<string, number>, to: Record<string, number>, dur = 300): Fragment =>
  ({ keyframes: [{ t: 0, ...from }, { t: dur, ...to }], playback: { duration: dur, delay, origin: 'offset', easing: 'ease-out' } } as Fragment);
const fadeIn = (at: number): Fragment => frag(at, { opacity: 0 }, { opacity: 1 });
const fadeOut = (at: number): Fragment => frag(at, { opacity: 1 }, { opacity: 0 });

describe('mergeFragment — the gap between two motions', () => {
  // A1b live check: re-sequencing a line to move its fade from 5400 to 600 kept
  // the old one, and the line faded out across the 4.5 s between them.
  it('refuses a second entrance on an entered layer, and says how to move one', () => {
    const existing = mergeFragment(undefined, fadeIn(5400)) as AnimationSpec;
    expect(() => mergeFragment(existing, fadeIn(600))).toThrow(MergeError);
    try { mergeFragment(existing, fadeIn(600)); } catch (e) {
      expect((e as MergeError).message).toMatch(/drift opacity 1 → 0 over the 4500 ms between 900 and 5400 ms/);
      expect((e as MergeError).hint).toMatch(/op:clear/);
    }
  });

  it('merges an entrance then an exit, and an exit then an entrance (hidden across the gap)', () => {
    const inOut = mergeFragment(mergeFragment(undefined, fadeIn(0)), fadeOut(3000));
    expect(inOut.keyframes?.map(k => k.opacity)).toEqual([0, 1, 1, 0]);
    const outIn = mergeFragment(mergeFragment(undefined, fadeOut(0)), frag(2000, { opacity: 0, y: 40 }, { opacity: 1, y: 0 }));
    expect(outIn.keyframes).toHaveLength(4);
  });

  it('lets a channel only the later motion names snap, as the engine plays it (a morph ahead of a fade-in)', () => {
    const morph: Fragment = { keyframes: [{ t: 0, d: 'M0 0' }, { t: 800, d: 'M1 1' }], playback: { duration: 800, delay: 500, origin: 'offset' } } as unknown as Fragment;
    expect(() => mergeFragment(mergeFragment(undefined, fadeIn(3000)), morph)).not.toThrow();
  });
});
