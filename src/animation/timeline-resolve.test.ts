import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import type { AnimationSpec } from './types';
import { resolveTimeline, retimeTrack, followTrack, usesTimeFeatures } from './timeline-resolve';
import { windowOf, aliveAt, lifeCSS, intersectWindows } from './lifespan';
import { valuesAt } from '../export/gif-frames';

const rise: AnimationSpec = {
  keyframes: [{ t: 0, y: 40, opacity: 0 }, { t: 500, y: 0, opacity: 1 }],
  playback: { duration: 500, origin: 'offset', easing: 'linear' },
};
const rect = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, ...extra } as unknown as Layer);
const group = (id: string, layers: Layer[], extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'group', z: 1, layers, ...extra } as unknown as Layer);
const find = (ls: Layer[], id: string): Record<string, unknown> => {
  for (const l of ls) {
    if (l.id === id) return l as unknown as Record<string, unknown>;
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (kids) { try { return find(kids, id); } catch { /* keep looking */ } }
  }
  throw new Error(`no ${id}`);
};

describe('lifespan', () => {
  it('reads a window, intersects it, and answers alive at a time', () => {
    const l = rect('a', { in: 1000, out: 3000 });
    expect(windowOf(l)).toEqual({ in: 1000, out: 3000 });
    expect(windowOf(rect('b'))).toBeNull();
    expect(windowOf(rect('c', { in: 500 }))).toEqual({ in: 500, out: Infinity });
    expect([aliveAt(l, 999), aliveAt(l, 1000), aliveAt(l, 2999), aliveAt(l, 3000)]).toEqual([false, true, true, false]);
    expect(intersectWindows({ in: 0, out: 2000 }, { in: 1000, out: 5000 })).toEqual({ in: 1000, out: 2000 });
  });

  it('steps visibility on the exact in and out points, and says nothing for a full-length window', () => {
    const css = lifeCSS('a', { in: 1000, out: 4000 });
    expect(css?.animation).toBe('life-a 4000ms linear 0ms 1 normal both');
    expect(css?.keyframes).toContain('0% { visibility: hidden; animation-timing-function: step-end; }');
    expect(css?.keyframes).toContain('25% { visibility: visible; animation-timing-function: step-end; }');
    expect(css?.keyframes).toContain('100% { visibility: hidden; }');
    expect(lifeCSS('b', { in: 0, out: Infinity })).toBeNull();
    expect(lifeCSS('c', { in: 800, out: Infinity })?.keyframes).toContain('100% { visibility: visible; }');
  });
});

describe('resolveTimeline', () => {
  it('returns the same array when nothing uses time features', () => {
    const ls = [rect('a', { animation: rise })];
    expect(usesTimeFeatures(ls)).toBe(false);
    expect(resolveTimeline(ls)).toBe(ls);
  });

  it('puts a precomp child on the scene clock: shifted by start, compressed by speed', () => {
    const ls = [group('pc', [rect('a', { animation: rise, in: 200, out: 1000 })], { clock: { start: 3000, speed: 2 } })];
    const out = resolveTimeline(ls);
    const a = find(out, 'a');
    const anim = a['animation'] as AnimationSpec;
    expect(anim.playback?.delay).toBe(3000);
    expect(anim.playback?.duration).toBe(250);
    expect(anim.keyframes?.[1]?.t).toBe(250);
    expect([a['in'], a['out']]).toEqual([3100, 3500]);
    expect(find(out, 'pc')['clock']).toBeUndefined();
    // The flipbook's sampler reads it on the scene clock: halfway through at 3125.
    expect(valuesAt(anim, 3125)['y']).toBeCloseTo(20, 5);
  });

  it('nests clocks: an inner precomp inside an outer one lands where both put it', () => {
    const inner = group('in', [rect('a', { animation: rise })], { clock: { start: 100 } });
    const out = resolveTimeline([group('out', [inner], { clock: { start: 1000, speed: 0.5 } })]);
    const pb = (find(out, 'a')['animation'] as AnimationSpec).playback;
    expect(pb?.delay).toBe(1200);      // 1000 + (100 + 0) / 0.5
    expect(pb?.duration).toBe(1000);   // 500 / 0.5
  });

  it('cycles a one-shot inside a looping precomp: held until its delay, cut at the period', () => {
    const late = { ...rise, playback: { ...rise.playback, duration: 500, delay: 300 } } as AnimationSpec;
    const r = retimeTrack(late, 0, 1, 1000);
    expect(r.playback?.loop).toBe(true);
    expect(r.playback?.duration).toBe(1000);
    expect(r.keyframes?.map(k => k.t)).toEqual([0, 300, 800, 1000]);
    expect(valuesAt(r, 150)['opacity']).toBe(0);
    expect(valuesAt(r, 1150)['opacity']).toBe(0);   // second cycle starts hidden again
    expect(valuesAt(r, 1900)['opacity']).toBe(1);
  });

  it('fills a linked wrapper with the target track, later and scaled', () => {
    const hero = rect('hero', { animation: { keyframes: [{ t: 0, x: 0, rotation: 0 }, { t: 400, x: 200, rotation: 10 }], playback: { duration: 400, origin: 'offset' } } });
    const tail = group('tail_link', [rect('tail')], { link: { to: 'hero', lag: 120, factor: 0.5, channels: ['x'] } });
    const out = resolveTimeline([hero, tail]);
    const anim = find(out, 'tail_link')['animation'] as AnimationSpec;
    expect(anim.playback?.delay).toBe(120);
    expect(anim.keyframes?.map(k => k['x'])).toEqual([0, 100]);
    expect(anim.keyframes?.[1]?.['rotation']).toBeUndefined();
    expect(find(out, 'tail_link')['link']).toBeUndefined();
  });

  it('follows a chain of links and survives a cycle', () => {
    const lead = rect('lead', { animation: { keyframes: [{ t: 0, y: 0 }, { t: 100, y: 50 }], playback: { duration: 100, origin: 'offset' } } });
    const one = rect('one', { link: { to: 'lead', lag: 50 } });
    const two = rect('two', { link: { to: 'one', lag: 50 } });
    const loopA = rect('la', { link: { to: 'lb' } });
    const loopB = rect('lb', { link: { to: 'la' } });
    const out = resolveTimeline([lead, one, two, loopA, loopB]);
    expect((find(out, 'two')['animation'] as AnimationSpec).playback?.delay).toBe(100);
    expect(find(out, 'la')['animation']).toBeUndefined();
  });

  it('scales opacity and scale travel from 1, and origin:first x from the first frame', () => {
    const t = followTrack({ keyframes: [{ t: 0, x: 100, scale: 0.5, opacity: 0 }, { t: 10, x: 300, scale: 1, opacity: 1 }], playback: { duration: 10, origin: 'first' } }, { to: 'x', factor: 0.5, channels: ['x', 'scale', 'opacity'] });
    expect(t?.keyframes?.map(k => [k['x'], k['scale'], k['opacity']])).toEqual([[100, 0.75, 0.5], [200, 1, 1]]);
  });

  it('a parent link turns about the parent pivot; a plain follower keeps its own anchor', () => {
    const spin: AnimationSpec = { keyframes: [{ t: 0, rotation: 0 }, { t: 1000, rotation: 90 }], playback: { duration: 1000, anchor: 'bottom' } };
    expect(followTrack(spin, { to: 'p', pivot: { x: 540, y: 675 } })?.playback).toEqual({ duration: 1000, pivot: { x: 540, y: 675 }, delay: 0 });
    // The parent's own pivot is live — it wins over the point stored at parenting.
    const hub = { ...spin, playback: { duration: 1000, pivot: { x: 10, y: 20 } } };
    expect(followTrack(hub, { to: 'p', pivot: { x: 540, y: 675 } })?.playback?.pivot).toEqual({ x: 10, y: 20 });
    expect(followTrack(hub, { to: 'p' })?.playback).toEqual({ duration: 1000, delay: 0 });
    expect(followTrack(spin, { to: 'p', lag: 80 })?.playback).toEqual({ duration: 1000, anchor: 'bottom', delay: 80 });
  });

  it('clips a child window to its group', () => {
    const out = resolveTimeline([group('g', [rect('a', { in: 500, out: 9000 }), rect('b')], { in: 1000, out: 4000 })]);
    expect([find(out, 'a')['in'], find(out, 'a')['out']]).toEqual([1000, 4000]);
    expect([find(out, 'b')['in'], find(out, 'b')['out']]).toEqual([1000, 4000]);
  });

  it('is idempotent and cached', () => {
    const ls = [group('pc', [rect('a', { animation: rise })], { clock: { start: 500 } })];
    const once = resolveTimeline(ls);
    expect(resolveTimeline(ls)).toBe(once);
    expect(resolveTimeline(once)).toBe(once);
  });
});
