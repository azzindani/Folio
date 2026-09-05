import { describe, it, expect } from 'vitest';
import {
  buildTimelineTracks,
  interpolateAtTime,
  renderTimelineASCII,
  addKeyframe,
  removeKeyframe,
  poseToLayerUpdate,
} from './timeline-panel';
import type { AnimationSpec } from '../../animation/types';
import type { Layer } from '../../schema/types';

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

  // Was: "skips a property missing from either surrounding keyframe". That
  // disagreed with the thing actually playing — the engine carries the last
  // authored value forward, so a track written as [{t:0,x:0},{t:1000}] really
  // does hold x at 0 the whole way, and the panel showed nothing while the CSS
  // player and the exported frames held it. The panel now samples through the
  // same poseAt the flipbook uses, so all three agree.
  it('carries a channel forward when a later keyframe omits it, as the player does', () => {
    const partial = [{ t: 0, x: 0 }, { t: 1000 }];
    expect(interpolateAtTime(partial, 500, 1000).x).toBe(0);
  });

  it('honours per-keyframe easing instead of always interpolating linearly', () => {
    const eased = [{ t: 0, x: 0, easing: 'ease-in' }, { t: 1000, x: 100 }];
    const linear = [{ t: 0, x: 0, easing: 'linear' }, { t: 1000, x: 100 }];
    const a = interpolateAtTime(eased as never, 500, 1000).x as number;
    const b = interpolateAtTime(linear as never, 500, 1000).x as number;
    expect(a).not.toBeCloseTo(b, 3);
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

describe('poseToLayerUpdate', () => {
  const base = { id: 'l', type: 'rect', x: 100, y: 50, width: 200, height: 100, rotation: 10 } as unknown as Layer;

  // x/y are OFFSETS, the same convention the flipbook uses — so a scrub
  // preview and an exported frame put the layer in the same place.
  it('adds x/y to the authored position rather than replacing it', () => {
    const u = poseToLayerUpdate(base, { x: 40, y: -10 } as never) as Record<string, unknown>;
    expect(u['x']).toBe(140);
    expect(u['y']).toBe(40);
  });

  it('adds rotation but sets opacity outright', () => {
    const u = poseToLayerUpdate(base, { rotation: 5, opacity: 0.5 } as never) as Record<string, unknown>;
    expect(u['rotation']).toBe(15);
    expect(u['opacity']).toBe(0.5);
  });

  it('skews about the layer centre, matching the exporter', () => {
    const t = String((poseToLayerUpdate(base, { skew_x: 20 } as never) as Record<string, unknown>)['transform']);
    expect(t).toContain('skewX(20.000)');
    expect(t).toContain('translate(200.00 100.00)');
  });

  it('merges blur into existing effects instead of replacing them', () => {
    const withFx = { ...(base as unknown as Record<string, unknown>), effects: { shadow: 'x' } } as unknown as Layer;
    const fx = (poseToLayerUpdate(withFx, { blur: 4 } as never) as Record<string, unknown>)['effects'] as Record<string, unknown>;
    expect(fx).toEqual({ shadow: 'x', blur: 4 });
  });

  it('writes nothing for a pose that moves nothing', () => {
    expect(poseToLayerUpdate(base, {} as never)).toEqual({});
  });
});
