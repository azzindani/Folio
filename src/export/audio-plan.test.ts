import { describe, it, expect } from 'vitest';
import type { AudioCue, DesignSpec } from '../schema/types';
import { planSound, clipGain, clipFilePosition } from './audio-plan';

const deck = (extra: Partial<DesignSpec>, cues: AudioCue[] = []): DesignSpec => ({
  document: { width: 1920, height: 1080, unit: 'px', dpi: 72 },
  pages: [{ id: 's1', layers: [] }, { id: 's2', layers: [], audio_cues: cues }],
  ...extra,
} as unknown as DesignSpec);

const timeline = { total_ms: 10_000, scenes: [{ page_id: 's1', start_ms: 0 }, { page_id: 's2', start_ms: 4000 }] };

describe('planSound', () => {
  it('places music on the piece and a cue at its scene', () => {
    const spec = deck({ audio: [{ id: 'music', src: 'assets/audio/bed.mp3', volume: 0.6, fade_in: 500, fade_out: 1000 }] },
      [{ src: 'assets/audio/whoosh.wav', at: 150 }]);
    const plan = planSound(spec, timeline, { 'assets/audio/bed.mp3': 30_000, 'assets/audio/whoosh.wav': 700 });
    expect(plan.clips).toEqual([
      expect.objectContaining({ id: 'music', start_ms: 0, length_ms: 10_000, volume: 0.6, fade_in_ms: 500, fade_out_ms: 1000, cut: true }),
      expect.objectContaining({ id: 's2-cue-1', scene: 's2', start_ms: 4150, length_ms: 700, cut: false }),
    ]);
    expect(plan.notes).toEqual([]);
  });

  it('notes music cut off with no fade, and music that runs out early', () => {
    const cutOff = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3' }] }), timeline, { 'a.mp3': 60_000 });
    expect(cutOff.notes.join(' ')).toMatch(/cut off at 10\.0s.*no fade/);
    const short = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3', fade_out: 500 }] }), timeline, { 'a.mp3': 6000 });
    expect(short.clips[0]?.length_ms).toBe(6000);
    expect(short.notes.join(' ')).toMatch(/runs out at 6\.0s; the last 4\.0s/);
  });

  it('notes a track whose duration stops it before the piece ends', () => {
    const early = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3', duration: 7000, fade_out: 800 }] }), timeline, { 'a.mp3': 60_000 });
    expect(early.notes.join(' ')).toMatch(/stops at 7\.0s because duration is 7000ms; the last 3\.0s .*Set duration to 10000/);
    const fits = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3', duration: 10_000, fade_out: 800 }] }), timeline, { 'a.mp3': 60_000 });
    expect(fits.notes).toEqual([]);
  });

  it('a loop fills the piece, and offset starts it mid-file', () => {
    const plan = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3', loop: true, offset: 1500, fade_out: 800 }] }), timeline, { 'a.mp3': 4000 });
    const clip = plan.clips[0];
    expect(clip).toMatchObject({ length_ms: 10_000, offset_ms: 1500, loop: true });
    if (!clip) return;
    expect(clipFilePosition(clip, 2000, 4000)).toBe(3500);
    expect(clipFilePosition(clip, 3000, 4000)).toBe(500);
    expect(plan.notes).toEqual([]);
  });

  it('leaves out what cannot sound, and says why', () => {
    const plan = planSound(deck({ audio: [{ id: 'late', src: 'a.mp3', start_time: 12_000 }, { id: 'past', src: 'b.mp3', offset: 9000 }] }),
      timeline, { 'a.mp3': 5000, 'b.mp3': 3000 });
    expect(plan.clips).toEqual([]);
    expect(plan.notes).toHaveLength(2);
  });

  it('fades linearly under the volume and is silent outside the clip', () => {
    const plan = planSound(deck({ audio: [{ id: 'm', src: 'a.mp3', volume: 0.8, fade_in: 1000, fade_out: 1000, duration: 4000 }] }), timeline, { 'a.mp3': 30_000 });
    const clip = plan.clips[0];
    if (!clip) throw new Error('no clip');
    expect([0, 500, 2000, 3500, 4500].map(t => Number(clipGain(clip, t).toFixed(3)))).toEqual([0, 0.4, 0.8, 0.4, 0]);
  });
});
