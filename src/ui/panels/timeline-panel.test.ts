import { describe, it, expect } from 'vitest';
import {
  buildTimelineTracks,
  interpolateAtTime,
  renderTimelineASCII,
  addKeyframe,
  removeKeyframe,
} from './timeline-panel';
import type { AnimationSpec } from '../../animation/types';

const kfs = [
  { t: 0,    opacity: 0,   x: 0   },
  { t: 500,  opacity: 0.5, x: 100 },
  { t: 1000, opacity: 1,   x: 200 },
];

describe('buildTimelineTracks', () => {
  it('returns empty array for layers with no keyframes', () => {
    const tracks = buildTimelineTracks([{ id: 'l1' }, { id: 'l2', animation: {} }]);
    expect(tracks).toHaveLength(0);
  });

  it('returns a track for each animated layer', () => {
    const layers = [
      { id: 'a', label: 'Layer A', animation: { keyframes: kfs, playback: { duration: 1000 } } as AnimationSpec },
      { id: 'b' },
    ];
    const tracks = buildTimelineTracks(layers);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].layerId).toBe('a');
    expect(tracks[0].layerName).toBe('Layer A');
  });

  it('uses id as layerName when label absent', () => {
    const layers = [{ id: 'x', animation: { keyframes: kfs, playback: { duration: 1000 } } as AnimationSpec }];
    const tracks = buildTimelineTracks(layers);
    expect(tracks[0].layerName).toBe('x');
  });

  it('defaults duration to 1000 when playback absent', () => {
    const layers = [{ id: 'x', animation: { keyframes: kfs } as AnimationSpec }];
    const tracks = buildTimelineTracks(layers);
    expect(tracks[0].duration).toBe(1000);
  });
});

describe('interpolateAtTime', () => {
  it('returns empty object for empty keyframes', () => {
    expect(interpolateAtTime([], 500, 1000)).toEqual({});
  });

  it('returns first keyframe when t is before start', () => {
    const result = interpolateAtTime(kfs, -100, 1000);
    expect(result.opacity).toBe(0);
  });

  it('returns last keyframe when t is after end', () => {
    const result = interpolateAtTime(kfs, 2000, 1000);
    expect(result.opacity).toBe(1);
  });

  it('interpolates opacity at midpoint', () => {
    const result = interpolateAtTime(kfs, 250, 1000);
    expect(result.opacity).toBeCloseTo(0.25);
  });

  it('interpolates x at midpoint', () => {
    const result = interpolateAtTime(kfs, 250, 1000);
    expect(result.x).toBeCloseTo(50);
  });

  it('returns exact value at keyframe time', () => {
    const result = interpolateAtTime(kfs, 500, 1000);
    expect(result.opacity).toBe(0.5);
    expect(result.x).toBe(100);
  });

  it('sets t in result', () => {
    expect(interpolateAtTime(kfs, 250, 1000).t).toBe(250);
  });

  it('skips property when missing from either surrounding keyframe', () => {
    const partial = [{ t: 0, x: 0 }, { t: 1000 }];
    const result = interpolateAtTime(partial, 500, 1000);
    expect(result.x).toBeUndefined();
  });
});

describe('renderTimelineASCII', () => {
  it('returns no-layers message for empty tracks', () => {
    expect(renderTimelineASCII([])).toBe('(no animated layers)');
  });

  it('contains header with max duration', () => {
    const tracks = [{ layerId: 'a', layerName: 'A', keyframes: kfs, duration: 1000 }];
    const out = renderTimelineASCII(tracks);
    expect(out).toContain('1000ms');
  });

  it('contains diamond markers for keyframes', () => {
    const tracks = [{ layerId: 'a', layerName: 'A', keyframes: kfs, duration: 1000 }];
    const out = renderTimelineASCII(tracks);
    expect(out).toContain('◆');
  });

  it('contains layer name', () => {
    const tracks = [{ layerId: 'hero', layerName: 'HeroLayer', keyframes: kfs, duration: 1000 }];
    expect(renderTimelineASCII(tracks)).toContain('HeroLayer');
  });

  it('respects custom width', () => {
    const tracks = [{ layerId: 'a', layerName: 'A', keyframes: kfs, duration: 1000 }];
    const out = renderTimelineASCII(tracks, 30);
    const lines = out.split('\n');
    // bar line: label(12) + |bar(30)|
    const barLine = lines[2];
    expect(barLine.length).toBeLessThanOrEqual(50);
  });
});

describe('addKeyframe', () => {
  it('adds a new keyframe', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0 }, { t: 1000 }] };
    const updated = addKeyframe(anim, { t: 500, opacity: 0.5 });
    expect(updated.keyframes?.length).toBe(3);
    expect(updated.keyframes?.[1].t).toBe(500);
  });

  it('replaces existing keyframe at same time', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 0.5 }] };
    const updated = addKeyframe(anim, { t: 500, opacity: 0.9 });
    expect(updated.keyframes?.length).toBe(2);
    expect(updated.keyframes?.[1].opacity).toBe(0.9);
  });

  it('sorts keyframes by time', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0 }, { t: 1000 }] };
    const updated = addKeyframe(anim, { t: 200 });
    expect(updated.keyframes?.map(k => k.t)).toEqual([0, 200, 1000]);
  });

  it('does not mutate original', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0 }] };
    addKeyframe(anim, { t: 500 });
    expect(anim.keyframes?.length).toBe(1);
  });
});

describe('removeKeyframe', () => {
  it('removes keyframe at given time', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0 }, { t: 500 }, { t: 1000 }] };
    const updated = removeKeyframe(anim, 500);
    expect(updated.keyframes?.length).toBe(2);
    expect(updated.keyframes?.some(k => k.t === 500)).toBe(false);
  });

  it('is no-op when time not found', () => {
    const anim: AnimationSpec = { keyframes: [{ t: 0 }, { t: 1000 }] };
    const updated = removeKeyframe(anim, 999);
    expect(updated.keyframes?.length).toBe(2);
  });

  it('handles empty keyframes', () => {
    const anim: AnimationSpec = {};
    const updated = removeKeyframe(anim, 500);
    expect(updated.keyframes).toEqual([]);
  });
});
