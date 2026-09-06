import { describe, it, expect } from 'vitest';
import { flattenForTimeline, timelineRows, sceneDuration } from './timeline-panel';
import type { Layer } from '../../schema/types';

// The studio has had play/pause/scrub all along — it just had nothing to show.
// The panel read `state.getCurrentLayers()`, which is TOP-LEVEL only, while
// every MCP-authored design is ONE group and animation(op:sequence) writes its
// keyframes onto that group's CHILDREN. So a design with a full three-track
// scene displayed an empty timeline, and exporting an HTML file was the only
// way to watch it. state.updateLayer already recursed; only the read did not.

const kf = (t: number): { t: number; opacity: number } => ({ t, opacity: t ? 1 : 0 });

const moving = (id: string, end = 700): Layer => ({
  id, type: 'text', x: 0, y: 0, width: 10, height: 10, z: 0,
  animation: { keyframes: [kf(0), kf(end)], playback: { duration: end } },
} as unknown as Layer);

const still = (id: string): Layer =>
  ({ id, type: 'rect', x: 0, y: 0, width: 10, height: 10, z: 0 } as unknown as Layer);

// What add_layers actually produces: the whole poster as one group.
const POSTER: Layer[] = [{
  id: 'editorial_1', type: 'group', x: 0, y: 0, width: 1080, height: 1080, z: 0,
  layers: [still('editorial_1_bg'), moving('editorial_1_title'), moving('editorial_1_sub', 1150)],
} as unknown as Layer];

describe('the timeline can see inside a group', () => {
  it('flattens the tree and records depth', () => {
    const rows = flattenForTimeline(POSTER);
    expect(rows.map(r => r.layer.id)).toEqual(['editorial_1', 'editorial_1_bg', 'editorial_1_title', 'editorial_1_sub']);
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 1]);
  });

  it('shows the animated layers of an MCP poster with nothing selected', () => {
    // This is the bug: top-level-only returned the one group, which has no
    // keyframes, so the panel rendered an empty timeline.
    const rows = timelineRows(POSTER, []);
    expect(rows.map(r => r.layer.id)).toEqual(['editorial_1_title', 'editorial_1_sub']);
  });

  it('falls back to the top level when nothing is animated yet', () => {
    // Otherwise a fresh design offers no row to click a first keyframe onto.
    const fresh = [still('a'), { ...still('g'), type: 'group', layers: [still('b')] }] as unknown as Layer[];
    expect(timelineRows(fresh, []).map(r => r.layer.id)).toEqual(['a', 'g']);
  });

  it('honours a selection at any depth', () => {
    expect(timelineRows(POSTER, ['editorial_1_bg']).map(r => r.layer.id)).toEqual(['editorial_1_bg']);
  });

  it('survives a malformed tree', () => {
    expect(() => flattenForTimeline([null, undefined] as never)).not.toThrow();
    expect(timelineRows(null as never, [])).toEqual([]);
  });
});

describe('the ruler fits the scene', () => {
  it('is as long as the last keyframe, not a fixed 2000ms', () => {
    // A sequence routinely runs longer than the old default, so pressing play
    // stopped a third of the way through the scene.
    expect(sceneDuration(POSTER)).toBe(1150);
  });

  it('counts a playback delay', () => {
    const delayed = [{ ...moving('d', 500), animation: { keyframes: [kf(0), kf(500)], playback: { duration: 500, delay: 300 } } }] as unknown as Layer[];
    expect(sceneDuration(delayed)).toBe(800);
  });

  it('falls back when there is no motion at all', () => {
    expect(sceneDuration([still('a')], 2000)).toBe(2000);
  });
});
