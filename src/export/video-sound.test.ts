import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { videoSoundClips, videoSources } from './video-sound';
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
