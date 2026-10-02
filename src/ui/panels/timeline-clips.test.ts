import { describe, it, expect } from 'vitest';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';
import { clipSpan, clipMarkup, trimmedAt, splitAtPlayhead, moveClip, mainTrackOf } from './timeline-clips';
import { trackHTML } from './timeline-track-view';

const take = (extra: Record<string, unknown> = {}): Layer =>
  ({ id: 'take', type: 'video', x: 0, y: 0, width: 320, height: 180, z: 0, src: 'assets/video/take.mp4', in: 1000, video: { offset_ms: 2000, duration_ms: 4000 }, ...extra }) as unknown as Layer;
const stateWith = (layers: Layer[]): StateManager => {
  const s = new StateManager();
  s.set('design', { _protocol: 'design/v1', document: { width: 320, height: 180 }, layers } as unknown as DesignSpec, false);
  return s;
};

describe('clip blocks', () => {
  it('span where the clip plays, and show its part of the file', () => {
    expect(clipSpan(take(), undefined, 10_000)).toEqual({ from: 1000, until: 5000 });
    const html = clipMarkup(take(), undefined, 10_000, 32);
    expect(html).toContain('left:10%');
    expect(html).toContain('width:40%');
    expect(html).toContain('file 2.0–6.0s');
    expect((html.match(/tl-clip-h/g) ?? []).length).toBe(2);
  });
  it('a video row draws its clip instead of in/out handles', () => {
    const row = trackHTML(take(), undefined, 10_000, 0);
    expect(row).toContain('tl-clip');
    expect(row).not.toContain('tl-life-h');
  });
});

describe('trimming by the grips', () => {
  it('the start grip skips footage; the end grip sets the length', () => {
    expect(trimmedAt(take(), 'start', 1500, undefined)).toEqual({ in: 1500, video: { offset_ms: 2500, duration_ms: 3500 } });
    expect(trimmedAt(take(), 'end', 3000, undefined)).toEqual({ video: { offset_ms: 2000, duration_ms: 2000 } });
  });
});

describe('✂ Split at the playhead', () => {
  it('cuts the clip under the playhead in two, as one undo step', () => {
    const state = stateWith([take()]);
    expect(splitAtPlayhead(state, 2000, null)).toBe(true);
    const ids = state.getCurrentLayers().map(l => l.id);
    expect(ids).toEqual(['take', 'take_2']);
    expect(state.findLayer('take_2')).toMatchObject({ in: 2000, video: { offset_ms: 3000, duration_ms: 3000 } });
    state.undo();
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['take']);
  });
  it('does nothing when no clip plays at the playhead', () => {
    const state = stateWith([take()]);
    expect(splitAtPlayhead(state, 9000, null)).toBe(false);
    expect(state.getCurrentLayers().length).toBe(1);
  });
});

describe('reordering the main track', () => {
  const clip = (id: string, at: number, len: number, extra: Record<string, unknown> = {}): Layer =>
    ({ id, type: 'video', z: 0, in: at, video: { offset_ms: 0, duration_ms: len }, ...extra }) as unknown as Layer;
  const a = clip('a', 0, 2000), b = clip('b', 2000, 3000), c = clip('c', 5000, 1000), pip = clip('pip', 1000, 500);

  it('finds the run of clips laid end to end', () => {
    expect(mainTrackOf([c, pip, a, b], 'b').map(l => l.id)).toEqual(['a', 'b', 'c']);
    expect(mainTrackOf([c, pip, a, b], 'pip').map(l => l.id)).toEqual(['pip']);
  });
  it('a clip dropped at the front takes the first place; the run is laid end to end again', () => {
    const p = moveClip([a, b, c], 'c', 300);
    expect(Object.fromEntries(p)).toEqual({ c: { in: 0 }, a: { in: 1000 }, b: { in: 3000 } });
  });
  it('dropped where it was, nothing changes; a clip on its own just moves', () => {
    expect(moveClip([a, b, c], 'b', 2100).size).toBe(0);
    expect(Object.fromEntries(moveClip([a, b, c, pip], 'pip', 4000))).toEqual({ pip: { in: 4000 } });
  });
  it('an out point moves with its clip', () => {
    const p = moveClip([clip('x', 0, 1000, { out: 1000 }), clip('y', 1000, 1000)], 'x', 1600);
    expect(Object.fromEntries(p)).toEqual({ y: { in: 0 }, x: { in: 1000, out: 2000 } });
  });
});
