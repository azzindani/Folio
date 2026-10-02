import { describe, it, expect } from 'vitest';
import { trimClip, splitClip, summarize, MIN_CLIP_MS, type ClipLayer } from './video-clip';

const clip = (extra: Partial<ClipLayer> = {}, video: Record<string, unknown> = {}): ClipLayer =>
  ({ id: 'c', type: 'video', z: 0, in: 1000, video: { offset_ms: 2000, duration_ms: 4000, ...video }, ...extra }) as unknown as ClipLayer;

describe('trimClip — the start edge skips footage, the end edge sets the length', () => {
  it('trimming the head moves in, offset and length together', () => {
    const t = trimClip(clip(), 'start', 1500);
    expect(t).toMatchObject({ in: 1500, video: { offset_ms: 2500, duration_ms: 3500 } });
    expect(summarize(t).plays.until).toBe(summarize(clip()).plays.until);   // the end does not move
  });
  it('dragging the head left brings footage back, but not before the file starts', () => {
    expect(trimClip(clip(), 'start', 500)).toMatchObject({ in: 500, video: { offset_ms: 1500, duration_ms: 4500 } });
    expect(trimClip(clip(), 'start', -5000)).toMatchObject({ in: 0, video: { offset_ms: 1000 } });
  });
  it('the end edge changes the length, clamped to the file and to a minimum', () => {
    expect(trimClip(clip(), 'end', 3000).video?.duration_ms).toBe(2000);
    expect(trimClip(clip(), 'end', 99_000, 10_000).video?.duration_ms).toBe(8000);
    expect(trimClip(clip(), 'end', 0).video?.duration_ms).toBe(MIN_CLIP_MS);
  });
  it('at double speed a scene ms is two file ms', () => {
    expect(trimClip(clip({}, { speed: 2 }), 'start', 1500)).toMatchObject({ in: 1500, video: { offset_ms: 3000, duration_ms: 3000 } });
  });
});

describe('splitClip', () => {
  it('the second half starts where the first stops, from the next frame of the file', () => {
    const [a, b] = splitClip(clip(), 2000, 'c_2');
    expect(a).toMatchObject({ out: 2000, video: { offset_ms: 2000, duration_ms: 1000 } });
    expect(b).toMatchObject({ id: 'c_2', in: 2000, video: { offset_ms: 3000, duration_ms: 3000 } });
    expect(splitClip(clip(), 900, 'x')).toEqual([]);
  });
});
