import { describe, it, expect } from 'vitest';
import type { Keyframe } from './types';
import { changedChannels } from './keyframe-segments';

const track = (...frames: Array<Record<string, unknown>>): Keyframe[] => frames as unknown as Keyframe[];

describe('changedChannels — a segment as the sampler plays it', () => {
  it('holds a channel only the earlier frame names: rise, hold, fade out', () => {
    const t = track({ t: 0, opacity: 0, y: 26 }, { t: 480, opacity: 1, y: 0 }, { t: 8500, opacity: 1, easing: 'ease-in' }, { t: 8950, opacity: 0 });
    expect(changedChannels(t, 0).map(c => c.key).sort()).toEqual(['opacity', 'y']);
    expect(changedChannels(t, 1)).toEqual([]);
    expect(changedChannels(t, 2)).toEqual([{ key: 'opacity', from: 1, to: 0 }]);
  });

  it('tweens a channel only the later frame names from the last value set before', () => {
    const t = track({ t: 0, x: 0, y: 40 }, { t: 400, x: 100 }, { t: 800, y: 0 });
    expect(changedChannels(t, 1)).toEqual([{ key: 'y', from: 40, to: 0 }]);
    // Never set before: it is there from the start, not moving over the segment.
    expect(changedChannels(track({ t: 0, x: 0 }, { t: 400, x: 0, rotation: 30 }), 0)).toEqual([]);
  });

  it('compares colours without case', () => {
    expect(changedChannels(track({ t: 0, 'fill.color': '#ffc857' }, { t: 400, 'fill.color': '#FFC857' }), 0)).toEqual([]);
  });
});
