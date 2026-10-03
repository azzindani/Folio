import { describe, it, expect, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';
import { clipJoins, clipMarkup, bindClipJoins, type ClipEditContext } from './timeline-clips';
import { trackHTML } from './timeline-track-view';
import { block } from './clip-controls';

const clip = (id: string, at: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'video', z: 1, x: 0, y: 0, width: 320, height: 180, src: `assets/video/${id}.mp4`, in: at, out: at + 2000, video: { offset_ms: 0, duration_ms: 2000 }, ...extra }) as unknown as Layer;
const stateWith = (layers: Layer[]): StateManager => {
  const s = new StateManager();
  s.set('design', { _protocol: 'design/v1', document: { width: 320, height: 180 }, layers } as unknown as DesignSpec, false);
  return s;
};

describe('clipJoins', () => {
  it('a clip starting where another stops is a join; the first clip and a gap are not', () => {
    const joins = clipJoins([clip('a', 0), clip('b', 2000), clip('c', 6000)]);
    expect([...joins.keys()]).toEqual(['b']);
  });
  it('carries the transition into the clip, and finds joins inside a group', () => {
    const group = { id: 'g', type: 'group', z: 2, x: 0, y: 0, width: 320, height: 180, layers: [clip('p', 0), clip('q', 2000, { video: { offset_ms: 0, duration_ms: 2000, transition: { type: 'dip', duration_ms: 300 } } })] } as unknown as Layer;
    const joins = clipJoins([group]);
    expect(joins.get('q')).toEqual({ transition: { type: 'dip', duration_ms: 300 } });
    expect(joins.has('p')).toBe(false);
  });
});

describe('the join marker on the track', () => {
  it('sits on the cut: filled with a transition, hollow without, absent on a clip with no join', () => {
    const plain = clipMarkup(clip('b', 2000), undefined, 10_000, 32, undefined, { join: {} });
    expect(plain).toContain('tl-join"');
    expect(plain).toContain('left:20%');
    expect(plain).toContain('A hard cut');
    const on = clipMarkup(clip('b', 2000), undefined, 10_000, 32, undefined, { join: { transition: { type: 'wipe', duration_ms: 800 } } });
    expect(on).toContain('tl-join tl-join-on');
    expect(on).toContain('Wipe · 800 ms');
    expect(clipMarkup(clip('a', 0), undefined, 10_000, 32)).not.toContain('tl-join');
    expect(trackHTML(clip('b', 2000), undefined, 10_000, 0, undefined, () => ({ join: {} }))).toContain('tl-join');
  });
});

describe('clicking a join', () => {
  let host: HTMLElement;
  afterEach(() => host?.remove());
  const setup = (layers: Layer[]): { state: StateManager; marker: HTMLElement; tabClicks: number[] } => {
    const state = stateWith(layers);
    host = document.createElement('div');
    const joins = clipJoins(layers);
    host.innerHTML = '<button class="rpanel-tab" data-tab="properties"></button><div id="body">'
      + layers.map(l => clipMarkup(l, undefined, 10_000, 32, undefined, { join: joins.get(l.id) })).join('') + '</div>';
    document.body.appendChild(host);
    const tabClicks: number[] = [];
    host.querySelector('.rpanel-tab')?.addEventListener('click', () => tabClicks.push(1));
    const ctx = { state, duration: () => 10_000, playhead: () => 0, rows: () => null, markers: () => ({}), preview: () => undefined } as ClipEditContext;
    bindClipJoins(host.querySelector('#body') as HTMLElement, ctx);
    return { state, marker: host.querySelector('.tl-join') as HTMLElement, tabClicks };
  };

  it('a hard cut gets a crossfade (one undo step), the clip is selected, the properties tab opens, the section shows open', () => {
    const { state, marker, tabClicks } = setup([clip('a', 0), clip('b', 2000)]);
    marker.click();
    expect((state.findLayer('b') as unknown as { video: { transition?: unknown } }).video.transition).toEqual({ type: 'crossfade' });
    expect(state.get().selectedLayerIds).toEqual(['b']);
    expect(tabClicks.length).toBe(1);
    expect(block('Transition', '', true)).not.toContain('collapsed');
    state.undo();
    expect((state.findLayer('b') as unknown as { video: { transition?: unknown } }).video.transition).toBeUndefined();
  });

  it('an existing transition is left as it is — the click only opens it', () => {
    const { state, marker } = setup([clip('a', 0), clip('b', 2000, { video: { offset_ms: 0, duration_ms: 2000, transition: { type: 'push', direction: 'up' } } })]);
    marker.click();
    expect((state.findLayer('b') as unknown as { video: { transition?: unknown } }).video.transition).toEqual({ type: 'push', direction: 'up' });
    expect(state.get().selectedLayerIds).toEqual(['b']);
  });
});
