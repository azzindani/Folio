import { describe, it, expect } from 'vitest';
import { trimClip, splitClip, summarize, MIN_CLIP_MS, type ClipLayer } from './video-clip';
import { fileOffsetAt, naturalLength, videoSourceMs, speedAt } from './video-time';

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

describe('freezes and speed ramps', () => {
  it('a still shows one frame for its hold and splits into two holds of that frame', () => {
    const still = clip({}, { offset_ms: 3000, duration_ms: 1000, still: true });
    expect(summarize(still)).toMatchObject({ plays: { from: 1000, until: 2000 }, file: { from: 3000, to: 3000 }, still: true });
    const [a, b] = splitClip(still, 1400, 'c_2');
    expect(a?.video).toMatchObject({ offset_ms: 3000, duration_ms: 400 });
    expect(b?.video).toMatchObject({ offset_ms: 3000, duration_ms: 600 });
  });
  it('a ramp plays the area under its speed curve; its length is the curve inverted', () => {
    // 1× for 1 s, then 1× → 0.5× over the next second, then 0.5×.
    const ramp = { ramp: [{ at_ms: 1000, speed: 1 }, { at_ms: 2000, speed: 0.5 }] };
    expect(fileOffsetAt(ramp, 1000)).toBe(1000);
    expect(fileOffsetAt(ramp, 2000)).toBeCloseTo(1750, 6);
    expect(fileOffsetAt(ramp, 3000)).toBeCloseTo(2250, 6);
    expect(naturalLength({ ...ramp, duration_ms: 2250 })).toBeCloseTo(3000, 0);
    expect(videoSourceMs(2000 + 500, 500, { offset_ms: 100, ...ramp })).toBe(1850);
  });
  it('splitting a ramp gives the second half the curve from the cut on', () => {
    const r = clip({ in: 0 }, { offset_ms: 0, duration_ms: 2250, ramp: [{ at_ms: 1000, speed: 1 }, { at_ms: 2000, speed: 0.5 }] });
    const [, b] = splitClip(r, 1500, 'c_2');
    expect(b?.video).toMatchObject({ offset_ms: 1438 });
    expect((b?.video as { ramp?: unknown }).ramp).toEqual([{ at_ms: 0, speed: 0.75 }, { at_ms: 500, speed: 0.5 }]);
    expect(speedAt(b?.video, 250)).toBeCloseTo(0.625, 6);
  });
});
