import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { Layer, DesignSpec } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import { rippled, rippleTrack, rippleLayers, emptyReport } from './motion-retime';
import { dispatchAnimation } from '../dispatch';
import { decodeJsonStringArgs } from '../json-string-args';
import { specAt } from '../../export/gif-frames';
import type { ToolResult } from '../types';

const track = (delay: number, frames: Array<Record<string, number | boolean>>, extra: object = {}): AnimationSpec =>
  ({ keyframes: frames as never, playback: { delay, duration: Number(frames[frames.length - 1]?.['t'] ?? 0) - Number(frames[0]?.['t'] ?? 0), origin: 'offset', ...extra } });

describe('rippled', () => {
  it('opens time at a point, and refuses a time a closed span swallows', () => {
    expect([999, 1000, 2000].map(t => rippled(t, { at: 1000, by: 500 }))).toEqual([999, 1500, 2500]);
    expect([1000, 1200, 1500, 2000].map(t => rippled(t, { at: 1000, by: -500 }))).toEqual([1000, null, 1000, 1500]);
  });
});

describe('rippleTrack', () => {
  it('moves a track that starts after the edit whole, and lets a rest across it simply last longer', () => {
    const rep = emptyReport();
    const late = rippleTrack('late', track(3000, [{ t: 0, y: 40 }, { t: 600, y: 0 }]), { at: 2000, by: 800 }, rep);
    expect(late.playback).toMatchObject({ delay: 3800, duration: 600 });
    // Lands at 600, rests until 5000, leaves by 5600: the rest spans the edit.
    const resting = rippleTrack('rest', track(0, [{ t: 0, y: 40 }, { t: 600, y: 0 }, { t: 5000, y: 0 }, { t: 5600, y: -40 }]), { at: 2000, by: 800 }, rep);
    expect(resting.keyframes?.map(k => k.t)).toEqual([0, 600, 5800, 6400]);
    expect(resting.playback?.duration).toBe(6400);
    expect(rep.stretched).toEqual([]);
  });

  it('opens time after a move that lands exactly at the edit — the move keeps its speed', () => {
    const rep = emptyReport();
    const fade = rippleTrack('fade', track(600, [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }]), { at: 1200, by: 4000 }, rep);
    expect(fade.keyframes?.map(k => k.t)).toEqual([0, 600]);
    expect(fade.playback).toMatchObject({ delay: 600, duration: 4600 });
    // A move STARTING at the edit still goes with it.
    const next = rippleTrack('next', track(1200, [{ t: 0, x: 0 }, { t: 400, x: 90 }]), { at: 1200, by: 4000 }, rep);
    expect(next.playback).toMatchObject({ delay: 5200, duration: 400 });
    expect(rep.stretched).toEqual([]);
  });

  it('names a move under way at the edit, and refuses to close a span a keyframe sits in', () => {
    const rep = emptyReport();
    rippleTrack('pan', track(1000, [{ t: 0, x: 0 }, { t: 2000, x: -500 }]), { at: 2000, by: 500 }, rep);
    expect(rep.stretched).toEqual(['pan 1000–3000ms → 1000–3500ms']);
    rippleTrack('pop', track(2200, [{ t: 0, scale: 0 }, { t: 300, scale: 1 }]), { at: 2000, by: -500 }, rep);
    expect(rep.blocked).toHaveLength(1);
  });
});

describe('rippleTrack — resting loops', () => {
  it('spreads an edit over every pass of a loop the layer rests in, keeping its rhythm', () => {
    // Lands at 500, then spins in 1000 ms passes (the storyboard unrolls a resting loop) until 4500.
    const spin: Array<Record<string, number | boolean>> = [{ t: 0, rotation: 0 }, { t: 500, rotation: 0, ambient: true }, { t: 1500, rotation: 360, ambient: true }, { t: 2500, rotation: 0, ambient: true }, { t: 3500, rotation: 360, ambient: true }, { t: 4500, rotation: 0 }, { t: 5000, rotation: 90 }];
    const rep = emptyReport();
    const out = rippleTrack('gear', track(0, spin), { at: 2000, by: 800 }, rep);
    expect(out.keyframes?.map(k => k.t)).toEqual([0, 500, 1700, 2900, 4100, 5300, 5800]);
    expect(rep.stretched).toEqual(['gear loop 500–4500ms → 500–5300ms (each pass ×1.20)']);
  });
});

describe('rippleLayers', () => {
  it('reaches into a precomp on its own clock, leaves a looping one alone, and moves windows', () => {
    const kid = { id: 'kid', type: 'rect', animation: track(1000, [{ t: 0, x: 0 }, { t: 200, x: 10 }]) };
    const pre = { id: 'pre', type: 'group', clock: { start: 1000, speed: 2 }, layers: [kid], in: 500, out: 6000 } as unknown as Layer;
    const loop = { id: 'loop', type: 'group', clock: { start: 0, loop: 800 }, layers: [{ ...kid, id: 'kid2' }] } as unknown as Layer;
    const rep = emptyReport();
    const [p, l] = rippleLayers([pre, loop], { at: 1400, by: 300 }, rep) as unknown as Array<Record<string, unknown> & { layers: Array<{ animation: AnimationSpec }> }>;
    // Scene 1400 is local (1400 − 1000) × 2 = 800, before the kid's delay of 1000: it moves by 300 × 2.
    expect(p?.layers[0]?.animation.playback?.delay).toBe(1600);
    expect([p?.['in'], p?.['out']]).toEqual([500, 6300]);
    expect(l?.layers[0]?.animation.playback?.delay).toBe(1000);
    expect(rep.untouched).toEqual(['loop (a looping precomp)']);
  });
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-retime-'));
let dPath = '', n = 0;
const text = (id: string, y: number, animation: AnimationSpec, extra: object = {}): object =>
  ({ id, type: 'text', z: 2, x: 100, y, width: 800, height: 80, content: { type: 'plain', value: id }, style: { font_size: 60 }, animation, ...extra });
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1920, height: 1080 },
    markers: { a: 0, b: 3000 },
    audio: [{ id: 'bed', src: 'lib/audio/bed.mp3', start_time: 0, duration: 6000 }, { id: 'whoosh', src: 'lib/audio/w.mp3', start_time: 3000 }],
    captions: { cues: [{ text: 'one', from_ms: 0, to_ms: 2500 }, { text: 'two', from_ms: 3000, to_ms: 5500 }] },
    layers: [
      text('one', 100, track(0, [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }, { t: 3000, opacity: 1 }, { t: 3300, opacity: 0 }])),
      text('two', 300, track(3000, [{ t: 0, opacity: 0, y: 40 }, { t: 500, opacity: 1, y: 0 }]), { in: 3000 }),
    ],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const call = async (a: Record<string, unknown>): Promise<ToolResult & Record<string, unknown>> =>
  (await dispatchAnimation(decodeJsonStringArgs('animation', { op: 'retime', design_path: dPath, ...a }))) as ToolResult & Record<string, unknown>;
const load = (): DesignSpec => yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec;

describe('animation op:retime', () => {
  it('opens a longer rest: every later pose, marker, sound and caption lands the same, that much later', async () => {
    const before = load();
    const r = await call({ at: 'a+2000', shift_ms: 800 });
    expect(r.success).toBe(true);
    const after = load();
    expect(after.markers).toEqual({ a: 0, b: 3800 });
    expect(after.audio?.map(a => [a.id, a.start_time, a.duration])).toEqual([['bed', 0, 6800], ['whoosh', 3800, undefined]]);
    // The first caption is up across the edit, so it stays up through the new time.
    expect(after.captions?.cues?.map(c => [c.from_ms, c.to_ms])).toEqual([[0, 3300], [3800, 6300]]);
    // What draws — not the track or window that put it there, which moved on purpose.
    const pose = (s: DesignSpec, t: number): string =>
      JSON.stringify((specAt(s, 0, t).layers ?? []).map(l => Object.fromEntries(Object.entries(l).filter(([k]) => !['animation', 'in', 'out'].includes(k)))));
    for (const t of [0, 1000, 1999]) expect(pose(after, t)).toBe(pose(before, t));
    for (const t of [3100, 3400, 5000]) expect(pose(after, t + 800)).toBe(pose(before, t));
  });

  it('refuses to close a span that something starts in, and names it', async () => {
    const r = await call({ at: 2800, shift_ms: -400 });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('marker b');
  });
});
