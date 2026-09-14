import { describe, it, expect } from 'vitest';
import { wiggleKeyframes } from './motion-wiggle';

describe('wiggleKeyframes', () => {
  const amp = { x: 12, y: 8, rotation: 3, scale: 0.05 };

  it('is the same wiggle on every call, and a different one for another seed', () => {
    expect(wiggleKeyframes('badge', amp, 2, 4000)).toEqual(wiggleKeyframes('badge', amp, 2, 4000));
    expect(wiggleKeyframes('badge', amp, 2, 4000)).not.toEqual(wiggleKeyframes('logo', amp, 2, 4000));
  });

  it('takes one step per 1/frequency seconds and closes the loop on its first pose', () => {
    const frames = wiggleKeyframes('badge', amp, 2, 4000);
    expect(frames).toHaveLength(9);
    expect(frames[frames.length - 1]?.t).toBe(4000);
    const pose = (f: object | undefined): Record<string, unknown> => Object.fromEntries(Object.entries(f ?? {}).filter(([k]) => k !== 't'));
    expect(pose(frames[frames.length - 1])).toEqual(pose(frames[0]));
  });

  it('never strays past its amplitude, and writes only the channels it was given', () => {
    const frames = wiggleKeyframes('badge', { x: 12, scale: 0.05 }, 3, 2000);
    for (const f of frames) {
      expect(Math.abs(f.x ?? 0)).toBeLessThanOrEqual(12);
      expect(Math.abs((f.scale ?? 1) - 1)).toBeLessThanOrEqual(0.05);
      expect(f.y).toBeUndefined();
      expect(f.rotation).toBeUndefined();
    }
  });
});
