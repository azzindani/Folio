import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { trackAround, planBeatCuts } from './beat-cut';

const clip = (id: string, at: number, offset: number, len: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, in: at, out: at + len, video: { offset_ms: offset, duration_ms: len }, ...extra }) as unknown as Layer;
// Three shots end to end: 0–2100, 2100–3900, 3900–6100; a PiP floats over them.
const a = clip('a', 0, 1000, 2100), b = clip('b', 2100, 3000, 1800), c = clip('c', 3900, 500, 2200), pip = clip('pip', 1000, 0, 800);
const grid = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500];

describe('the track around a clip', () => {
  it('follows joins both ways, in play order; a clip floating over it is not on it', () => {
    expect(trackAround([c, pip, a, b], 'b').map(l => l.id)).toEqual(['a', 'b', 'c']);
    expect(trackAround([c, pip, a, b], 'pip').map(l => l.id)).toEqual(['pip']);
  });
});

describe('snapping joins to the beat', () => {
  it('each join moves to its nearest beat; the frames at the join stay continuous on both clocks', () => {
    const plan = planBeatCuts([a, b, c], grid, { fileMs: { a: 10_000, b: 10_000, c: 10_000 } });
    expect(plan.moved).toEqual([
      { between: ['a', 'b'], from_ms: 2100, to_ms: 2000 },
      { between: ['b', 'c'], from_ms: 3900, to_ms: 4000 },
      { between: ['c', 'c'], from_ms: 6100, to_ms: 6000 },
    ]);
    expect(plan.patches.get('a')).toMatchObject({ in: 0, out: 2000, video: { offset_ms: 1000, duration_ms: 2000 } });
    // b now starts 100 ms sooner, from 100 ms earlier in its file, and runs to the next join.
    expect(plan.patches.get('b')).toMatchObject({ in: 2000, out: 4000, video: { offset_ms: 2900, duration_ms: 2000 } });
    expect(plan.patches.get('c')).toMatchObject({ in: 4000, out: 6000, video: { offset_ms: 600, duration_ms: 2000 } });
  });

  it('a join stays when the footage is not there, and says why', () => {
    // b's file starts at its offset 0: it cannot start sooner, so the a|b join may only move later — and a's file ends.
    const tight = [clip('a', 0, 0, 2100), clip('b', 2100, 0, 1800)];
    const plan = planBeatCuts(tight, grid, { fileMs: { a: 2100, b: 10_000 }, end: false });
    expect(plan.moved).toEqual([]);
    expect(plan.kept[0]).toMatchObject({ between: ['a', 'b'], at_ms: 2100 });
    expect(plan.kept[0]?.reason).toMatch(/file (ends|begins)/);
  });

  it('a join never runs a clip into the next shot of its file, nor starts one in the shot before', () => {
    // a's used part ends at file 3100 and its file cuts to a new shot at 3150: it may run on 50 ms, not 100.
    // b starts at file 3000 with a cut at 2950: it may start 50 ms sooner, not 100. So the 2100 join cannot reach 2000 or 2200.
    const plan = planBeatCuts([a, b], [0, 1000, 2000, 2200, 3000], { fileMs: { a: 10_000, b: 10_000 }, shots: { a: [3150], b: [2950] }, end: false });
    expect(plan.moved).toEqual([]);
    expect(plan.kept[0]?.reason).toMatch(/another shot|shot before/);
  });

  it('every:4 snaps to bar lines only; max_shift_ms leaves joins that would travel too far', () => {
    const bars = planBeatCuts([a, b, c], grid, { every: 4, end: false, fileMs: { a: 10_000, b: 10_000, c: 10_000 } });
    expect(bars.moved.map(m => m.to_ms)).toEqual([2000, 4000]);
    const close = planBeatCuts([a, b, c], grid, { max_shift_ms: 50, end: false });
    expect(close.moved).toEqual([]);
    expect(close.kept.map(k => k.reason)).toEqual(['no beat near it', 'no beat near it']);
  });
});
