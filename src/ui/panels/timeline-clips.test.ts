import { describe, it, expect } from 'vitest';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';
import { clipSpan, clipMarkup, trimmedAt, splitAtPlayhead, moveClip, mainTrackOf, rippleDelete, clipEdges } from './timeline-clips';
import { stripTimes, clipWave } from './timeline-filmstrip';
import { deleteSelected, splitClipAt } from '../../editor/layer-actions';
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

describe('ripple delete and the edges clips snap to', () => {
  // Three clips end to end on the main track (0–2000, 2000–5000, 5000–6000) and a lone one over them.
  const clip = (id: string, at: number, len: number): Layer =>
    ({ id, type: 'video', x: 0, y: 0, width: 320, height: 180, z: 0, src: `assets/video/${id}.mp4`, in: at, out: at + len, video: { offset_ms: 0, duration_ms: len } }) as unknown as Layer;
  const track = (): Layer[] => [clip('a', 0, 2000), clip('b', 2000, 3000), clip('c', 5000, 1000), clip('pip', 1000, 1500)];

  it('closes the gap a clip leaves on its track; a lone clip leaves its gap', () => {
    expect([...rippleDelete(track(), ['b'])]).toEqual([['c', { in: 2000, out: 3000 }]]);
    expect([...rippleDelete(track(), ['a', 'b'])]).toEqual([['c', { in: 0, out: 1000 }]]);
    expect(rippleDelete(track(), ['pip']).size).toBe(0);
  });
  it('Del through the editor: one undo puts the clip back and the track where it was', () => {
    const state = stateWith(track());
    state.set('selectedLayerIds', ['b'], false);
    deleteSelected(state);
    expect(state.getCurrentLayers().map(l => [l.id, (l as { in?: number }).in])).toEqual([['a', 0], ['c', 2000], ['pip', 1000]]);
    state.undo();
    expect(state.getCurrentLayers().map(l => [l.id, (l as { in?: number }).in])).toEqual([['a', 0], ['b', 2000], ['c', 5000], ['pip', 1000]]);
  });
  it('S cuts the selected clip at the playhead', () => {
    const state = stateWith(track());
    state.set('selectedLayerIds', ['b'], false);
    expect(splitClipAt(state, 3000, null)).toBe(true);
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a', 'b', 'b_2', 'c', 'pip']);
  });
  it('the other clips\' starts and ends are snap points', () => {
    expect(clipEdges(track(), 'b', null, 10_000).sort((x, y) => x - y)).toEqual([0, 1000, 2000, 2500, 5000, 6000]);
  });
});

describe('the block\'s footage and sound', () => {
  it('a thumbnail per ~5% of the ruler, at file moments rounded to 100 ms', () => {
    expect(stripTimes(take(), 40)).toEqual([2300, 2800, 3300, 3800, 4300, 4800, 5300, 5800]);
    expect(stripTimes(take(), 2)).toEqual([4000]);
  });
  it('the waveform covers the part of the file it plays; muted or unmeasured shows none', () => {
    const samples = new Float32Array(11_025 * 8).map((_, i) => (i < 11_025 * 4 ? 0.1 : 0.9));
    const a = { samples, duration_ms: 8000, beats_ms: [], bpm: 0 };
    const w = clipWave(take(), a, 4) ?? [];
    expect(w.map(v => +v.toFixed(1))).toEqual([0.1, 0.1, 0.9, 0.9]);
    expect(clipWave(take({ video: { offset_ms: 2000, duration_ms: 4000, muted: true } }), a)).toBeNull();
    expect(clipWave(take(), null)).toBeNull();
  });
  it('dresses the block under its label: thumbnails (a gap while one loads) and the waveform', () => {
    const html = clipMarkup(take(), undefined, 10_000, 32, () => ({ thumbs: ['data:image/jpeg;base64,AA', undefined], wave: [0.5, 1] }));
    expect(html).toContain('<div class="tl-clip-strip"><img src="data:image/jpeg;base64,AA" alt=""><span></span></div>');
    expect(html).toContain('class="tl-clip-wave"');
    expect(html.indexOf('tl-clip-strip')).toBeLessThan(html.indexOf('tl-clip-label'));
  });
});
