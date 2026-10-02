import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { videoSoundClips, videoSources, SEAM_FADE_MS } from './video-sound';
import { planSound, clipFilePosition } from './audio-plan';
import { atempoChain, soundFilter } from './audio-mux';

const vid = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', src: `assets/video/${id}.mp4`, x: 0, y: 0, width: 100, height: 100, z: 1, ...extra }) as unknown as Layer;

describe('videoSoundClips', () => {
  it('sounds from the in point, from the offset, for the used part at speed', () => {
    const [c] = videoSoundClips([vid('a', { in: 1000, video: { offset_ms: 500, duration_ms: 4000, speed: 2, volume: 0.5 } })], 0, 20_000);
    expect(c).toMatchObject({ id: 'a-sound', start_ms: 1000, offset_ms: 500, length_ms: 2000, volume: 0.5, speed: 2 });
  });

  it('stops at the out point and the end of the piece; a muted clip is silent', () => {
    const [c] = videoSoundClips([vid('a', { in: 0, out: 3000 })], 0, 10_000, { 'assets/video/a.mp4': 8000 });
    expect(c?.length_ms).toBe(3000);
    const [d] = videoSoundClips([vid('b', { in: 7000 })], 0, 10_000, { 'assets/video/b.mp4': 8000 });
    expect(d).toMatchObject({ length_ms: 3000, cut: true });
    expect(videoSoundClips([vid('m', { video: { muted: true } })], 0, 10_000)).toEqual([]);
  });

  it('finds clips inside groups and offsets them by their scene', () => {
    const g = { id: 'g', type: 'group', layers: [vid('a')] } as unknown as Layer;
    expect(videoSoundClips([g], 5000, 10_000, { 'assets/video/a.mp4': 2000 })[0]?.start_ms).toBe(5000);
    expect(videoSources([g])).toEqual(['assets/video/a.mp4']);
  });
});

describe('cut edges, fades and J/L cuts', () => {
  const F = { 'assets/video/a.mp4': 8000 };
  const one = (extra: Record<string, unknown>, file: Record<string, number> = F): ReturnType<typeof videoSoundClips>[number] | undefined =>
    videoSoundClips([vid('a', extra)], 0, 20_000, file)[0];

  it('a cut edge fades out the click; the file\'s own start and end stay as recorded', () => {
    expect(one({ in: 1000, video: { offset_ms: 2000, duration_ms: 3000 } })).toMatchObject({ fade_in_ms: SEAM_FADE_MS, fade_out_ms: SEAM_FADE_MS });
    expect(one({ in: 0 }, { 'assets/video/a.mp4': 3000 })).toMatchObject({ length_ms: 3000, fade_in_ms: 0, fade_out_ms: 0 });
  });

  it('a split the file plays straight through keeps no dip; a jump in the file does', () => {
    const halves = [vid('a', { in: 0, video: { offset_ms: 1000, duration_ms: 2000 } }), vid('a', { id: 'a_2', in: 2000, video: { offset_ms: 3000, duration_ms: 2000 } })];
    const [x, y] = videoSoundClips(halves, 0, 20_000, F);
    expect([x?.fade_out_ms, y?.fade_in_ms]).toEqual([0, 0]);
    expect(x?.fade_in_ms).toBe(SEAM_FADE_MS);   // its head still cuts into the file
    const jumped = [halves[0] as Layer, vid('a', { id: 'a_2', in: 2000, video: { offset_ms: 4500, duration_ms: 2000 } })];
    expect(videoSoundClips(jumped, 0, 20_000, F).map(c => [c.fade_in_ms, c.fade_out_ms])).toEqual([[SEAM_FADE_MS, SEAM_FADE_MS], [SEAM_FADE_MS, SEAM_FADE_MS]]);
  });

  it('asked-for fades win over the seam, and never overrun the clip', () => {
    expect(one({ video: { offset_ms: 1000, duration_ms: 3000, fade_in_ms: 400, fade_out_ms: 900 } })).toMatchObject({ fade_in_ms: 400, fade_out_ms: 900 });
    expect(one({ video: { offset_ms: 1000, duration_ms: 1000, fade_in_ms: 800, fade_out_ms: 800 } })).toMatchObject({ fade_in_ms: 500, fade_out_ms: 500 });
  });

  it('audio_lead_ms starts the sound before its picture, within the file and the scene', () => {
    expect(one({ in: 5000, video: { offset_ms: 3000, duration_ms: 2000, audio_lead_ms: 1000 } })).toMatchObject({ start_ms: 4000, offset_ms: 2000, length_ms: 3000 });
    // Only 300 ms of file before the offset: the lead stops at the file's start, which needs no fade.
    expect(one({ in: 5000, video: { offset_ms: 300, duration_ms: 2000, audio_lead_ms: 1000 } })).toMatchObject({ start_ms: 4700, offset_ms: 0, fade_in_ms: 0 });
    expect(one({ in: 200, video: { offset_ms: 3000, duration_ms: 2000, audio_lead_ms: 1000 } })?.start_ms).toBe(0);
  });

  it('audio_tail_ms runs the sound on past the picture, while the file has sound', () => {
    expect(one({ in: 0, out: 3000, video: { offset_ms: 0, duration_ms: 3000, audio_tail_ms: 1500 } })).toMatchObject({ length_ms: 4500, fade_out_ms: SEAM_FADE_MS });
    expect(one({ in: 0, video: { offset_ms: 0, duration_ms: 3000, audio_tail_ms: 1500 } }, { 'assets/video/a.mp4': 3500 })).toMatchObject({ length_ms: 3500, fade_out_ms: 0 });
    // At double speed the picture uses 2 s of file per piece second; so does the tail.
    expect(one({ in: 0, video: { offset_ms: 0, duration_ms: 4000, speed: 2, audio_tail_ms: 1000 } })?.length_ms).toBe(3000);
  });
});

describe('the plan and the mix', () => {
  it('a one-page piece plans its clip under the soundtrack', () => {
    const spec = { meta: { name: 't', version: '1' }, document: { width: 100, height: 100, unit: 'px' }, layers: [vid('a', { video: { speed: 0.5 } })] } as unknown as DesignSpec;
    const plan = planSound(spec, { total_ms: 6000, scenes: [] }, { 'assets/video/a.mp4': 2000 });
    expect(plan.clips.map(c => [c.id, c.length_ms, c.speed])).toEqual([['a-sound', 4000, 0.5]]);
    expect(clipFilePosition(plan.clips[0] as never, 2000)).toBe(1000);
  });

  it('chains atempo within 0.5–2 and trims the file time a clip at speed uses', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    const f = soundFilter([{ id: 'a', src: 'x', file: '/x.mp4', start_ms: 0, offset_ms: 0, length_ms: 1000, volume: 1, fade_in_ms: 0, fade_out_ms: 0, loop: false, cut: false, speed: 2 }], 2000);
    expect(f).toContain('atrim=duration=2.000,atempo=2');
  });
});
