import { describe, it, expect } from 'vitest';
import type { ClipLayer } from './video-clip';
import { applyTimingEdits, applyLookEdits, editClip, MAX_EDGE_MS } from './clip-edit';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): ClipLayer =>
  ({ id, type: 'video', z: 1, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 0, duration_ms: 2000 }, ...extra }) as unknown as ClipLayer;
const fail = (r: ReturnType<typeof editClip>): string => ('error' in r ? r.error : '');

describe('clip edits — the rules op:video and the inspector share', () => {
  it('timing: speed, volume (clamped), mute, loop and the edge sound; 0 or null clears a fade', () => {
    const c = clip('a', 0);
    expect(applyTimingEdits(c, { speed: 2, volume: 3, muted: true, loop: true, fade_in: 300, audio_lead_ms: 250.4 })).toBeNull();
    expect(c.video).toMatchObject({ speed: 2, volume: 1, muted: true, loop: true, fade_in_ms: 300, audio_lead_ms: 250 });
    expect(applyTimingEdits(c, { fade_in: 0, audio_lead_ms: null })).toBeNull();
    expect(c.video).not.toHaveProperty('fade_in_ms');
    expect(c.video).not.toHaveProperty('audio_lead_ms');
  });
  it('timing refuses a speed outside 0.1–8 and an edge outside 1–10000 ms, with the engine\'s words', () => {
    expect(applyTimingEdits(clip('a', 0), { speed: 20 })).toMatchObject({ error: 'speed 20 is out of range.', hint: expect.stringContaining('0.1–8') });
    expect(applyTimingEdits(clip('a', 0), { fade_out: MAX_EDGE_MS + 1 })?.error).toContain('fade_out');
    expect(applyTimingEdits(clip('a', 0), { audio_tail_ms: -5 })?.error).toContain('out of range');
  });
  it('look: a transition needs a clip ending where it starts; crop, ramp, grade and key are read by the engine\'s own readers', () => {
    const a = clip('a', 0), b = clip('b', 2000);
    expect(fail(editClip(b, { clip_transition: { type: 'crossfade', duration_ms: 400 } }, []))).toContain('No clip ends where "b" starts');
    const joined = editClip(b, { clip_transition: { type: 'crossfade', duration_ms: 400 } }, [a, b]);
    expect('error' in joined).toBe(false);
    expect((joined as ClipLayer).video?.transition).toEqual({ type: 'crossfade', duration_ms: 400 });
    expect(fail(editClip(b, { clip_transition: { type: 'spin' } }, [a, b]))).toContain('Unknown transition type');
    const dressed = editClip(a, { focus: [0.2, 0.8], zoom: 2, ramp: [{ at_ms: 500, speed: 0.5 }, { at_ms: 0, speed: 1 }], color: { exposure: 0.5 }, key: { color: '#00ff00' } }) as ClipLayer;
    expect(dressed.video).toMatchObject({ focus: [0.2, 0.8], zoom: 2, ramp: [{ at_ms: 0, speed: 1 }, { at_ms: 500, speed: 0.5 }], color: { exposure: 0.5 } });
    expect(dressed.video).toHaveProperty('key');
    expect(fail(editClip(a, { zoom: 9 }))).toContain('zoom');
    expect(fail(editClip(a, { ramp: [{ at_ms: 0, speed: 99 }] }))).toContain('ramp');
    expect(fail(editClip(a, { key: { color: '#808080' } }))).toContain('grey');
    expect(fail(editClip(a, { color: { glow: 1 } }))).toContain('no glow');
  });
  it('null clears each look field; a freeze has no speed to ramp; the clip itself is never mutated', () => {
    const c = clip('a', 0, { video: { offset_ms: 0, duration_ms: 2000, color: { exposure: 1 }, key: { color: '#00ff00', similarity: 0.4, blend: 0.1 }, focus: [0, 0], zoom: 2, transition: { type: 'dip' } } });
    const cleared = editClip(c, { color: null, key: null, focus: null, zoom: null, clip_transition: null }) as ClipLayer;
    expect(cleared.video).toEqual({ offset_ms: 0, duration_ms: 2000 });
    expect(c.video).toHaveProperty('color');
    expect(fail(editClip(clip('f', 0, { video: { still: true, offset_ms: 0, duration_ms: 500 } }), { ramp: [{ at_ms: 0, speed: 2 }] }))).toContain('freeze');
    expect(applyLookEdits(clip('x', 0), {}, [])).toBeNull();
  });
});
