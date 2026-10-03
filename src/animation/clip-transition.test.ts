import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { specAt } from '../export/gif-frames';
import { applyClipTransitions, predecessorOf, transitionWindow } from './clip-transition';
import { resolveTimeline } from './timeline-resolve';
import { videoSoundClips } from '../export/video-sound';

type C = Layer & { in?: number; out?: number; animation?: { keyframes: Array<Record<string, number | string>>; playback: Record<string, unknown> }; layers?: Layer[];
  video: { offset_ms: number; duration_ms: number; fade_in_ms?: number; fade_out_ms?: number; transition?: Record<string, unknown> } };
const clip = (id: string, at: number, offset: number, len: number, extra: Record<string, unknown> = {}): C =>
  ({ id, type: 'video', src: `assets/video/${id}.mp4`, x: 0, y: 0, width: 1920, height: 1080, z: 1, in: at, out: at + len, video: { offset_ms: offset, duration_ms: len }, ...extra }) as unknown as C;
const pair = (t: Record<string, unknown>, bOffset = 3000): Layer[] =>
  [clip('a', 0, 1000, 2000), clip('b', 2000, bOffset, 2000, { video: { offset_ms: bOffset, duration_ms: 2000, transition: t } })];
const byId = (ls: Layer[], id: string): C => ls.find(l => l.id === id) as C;
/** A track's keys back on the scene clock: they are written from the first at t 0, played from `delay`. */
const onScene = (c: C): Array<Record<string, number | string>> | undefined =>
  (c.animation?.keyframes as Array<Record<string, number | string>> | undefined)?.map(k => ({ ...k, t: Number(k['t']) + Number(c.animation?.playback['delay'] ?? 0) }));

describe('which clip a transition comes from, and over what window', () => {
  it('the clip ending where it starts; the window centred on the cut when the file has footage before', () => {
    const [a, b] = pair({ type: 'crossfade' }) as [Layer, Layer];
    expect(predecessorOf([a, b], b)).toBe(a);
    expect(transitionWindow(a, b, { type: 'crossfade', duration_ms: 600 })).toEqual({ cut: 2000, before: 300, after: 300 });
    // No footage before the incoming clip's offset: the whole window falls after the cut.
    const [, b0] = pair({ type: 'crossfade' }, 0) as [Layer, Layer];
    expect(transitionWindow(a, b0, { type: 'crossfade', duration_ms: 600 })).toEqual({ cut: 2000, before: 0, after: 600 });
  });
});

describe('compiled into windows and keys', () => {
  it('crossfade: both clips widen over the cut, the one on top fades in, the sounds crossfade', () => {
    const out = applyClipTransitions(pair({ type: 'crossfade', duration_ms: 500 }));
    const a = byId(out, 'a'), b = byId(out, 'b');
    expect([a.out, a.video.duration_ms, a.video.fade_out_ms]).toEqual([2250, 2250, 500]);
    expect([b.in, b.video.offset_ms, b.video.duration_ms, b.video.fade_in_ms]).toEqual([1750, 2750, 2250, 500]);
    expect(onScene(b)).toEqual([{ t: 1750, opacity: 0 }, { t: 2250, opacity: 1 }]);
    expect(b.animation?.playback).toMatchObject({ delay: 1750, duration: 500 });
    expect(a.animation).toBeUndefined();
  });

  it('dip: a colour rect under both for the window, out then in', () => {
    const out = applyClipTransitions(pair({ type: 'dip', duration_ms: 400, color: '#ffffff' }));
    expect(out.map(l => l.id)).toEqual(['b__dip', 'a', 'b']);
    expect(byId(out, 'b__dip')).toMatchObject({ type: 'rect', in: 1800, out: 2200, fill: { color: '#ffffff' } });
    expect(onScene(byId(out, 'a'))).toEqual([{ t: 1800, opacity: 1 }, { t: 2000, opacity: 0 }]);
    expect(onScene(byId(out, 'b'))).toEqual([{ t: 2000, opacity: 0 }, { t: 2200, opacity: 1 }]);
  });

  it('wipe: the top clip is uncovered from the side the edge leaves', () => {
    const b = byId(applyClipTransitions(pair({ type: 'wipe', direction: 'left' })), 'b');
    expect(b.animation?.playback['reveal_from']).toBe('right');
    expect(b.animation?.keyframes.map(k => k['reveal'])).toEqual([0, 1]);
  });

  it('push: the outgoing clip leaves by a frame width as the incoming arrives', () => {
    const out = applyClipTransitions(pair({ type: 'push', direction: 'left', duration_ms: 400 }));
    expect(byId(out, 'a').animation?.keyframes.map(k => k['x'])).toEqual([0, -1920]);
    expect(byId(out, 'b').animation?.keyframes.map(k => k['x'])).toEqual([1920, 0]);
  });

  it('a clip that already moves keeps its motion; the transition rides a wrapper', () => {
    const [a, b] = pair({ type: 'crossfade' }) as [C, C];
    const moving = { ...b, animation: { keyframes: [{ t: 0, scale: 1 }, { t: 2000, scale: 1.1 }], playback: { duration: 2000 } } } as unknown as Layer;
    const w = applyClipTransitions([a, moving]).find(l => l.id === 'b__tx0') as C;
    expect(w.type).toBe('group');
    expect((w.layers?.[0] as C).animation?.keyframes[1]).toEqual({ t: 2000, scale: 1.1 });
  });

  it('nothing to do: no transition, or no clip to come from', () => {
    const plain = [clip('a', 0, 0, 2000)];
    expect(applyClipTransitions(plain)).toBe(plain);
    const lone = applyClipTransitions([clip('b', 5000, 0, 1000, { video: { offset_ms: 0, duration_ms: 1000, transition: { type: 'dip' } } })]);
    expect(byId(lone, 'b').in).toBe(5000);
  });
});

describe('it plays at the times it says', () => {
  it('sampled frames: the incoming clip is half in at the middle of a centred crossfade', () => {
    const spec = { document: { width: 1920, height: 1080 }, layers: pair({ type: 'crossfade', duration_ms: 500 }) } as unknown as DesignSpec;
    const op = (t: number): number => Number((specAt(spec, 0, t).layers ?? []).find(l => l.id === 'b')?.opacity ?? 1);
    expect([op(1750), op(2000), op(2250), op(2400)].map(v => Math.round(v * 100) / 100)).toEqual([0, 0.5, 1, 1]);
  });
});

describe('every player gets it through resolveTimeline', () => {
  it('the resolved tree and the sound plan both carry the transition', () => {
    const layers = pair({ type: 'crossfade', duration_ms: 500 });
    expect(byId(resolveTimeline(layers), 'b').in).toBe(1750);
    const [sa, sb] = videoSoundClips(layers, 0, 10_000);
    expect([sa?.length_ms, sa?.fade_out_ms]).toEqual([2250, 500]);
    expect([sb?.start_ms, sb?.offset_ms, sb?.fade_in_ms]).toEqual([1750, 2750, 500]);
  });
});
