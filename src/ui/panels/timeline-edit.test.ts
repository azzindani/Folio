import { describe, it, expect, vi, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';
import type { RowTiming } from '../../editor/motion-pose';
import { msAt, edgePatch, withMarkers, markerNameProblem, freshMarkerName, bindTimelineEdits } from './timeline-edit';
import { trackHTML, markerStripHTML, markersOf } from './timeline-track-view';

const row = (window: RowTiming['window'], clocks: RowTiming['clocks'] = []): RowTiming =>
  ({ keys: [], ghosts: [], start: 0, end: 0, loop: false, window, link: null, clocks });

describe('timeline editing — the numbers', () => {
  it('snaps a drag to a marker, the playhead or an end within 6 px, else to 10 ms', () => {
    const area = { left: 0, width: 1000 };
    expect(msAt(503, area, 10000, [5000])).toBe(5000);
    expect(msAt(512, area, 10000, [5000])).toBe(5120);
    expect(msAt(-40, area, 10000, [])).toBe(0);
  });

  it('writes an edge in the layer\'s own clock, and removes it at the start or the end of the ruler', () => {
    const inPrecomp = row({ in: 1000, out: Infinity }, [{ start: 1000, speed: 2 }]);
    expect(edgePatch('in', 1500, inPrecomp, 8000)).toEqual({ in: 1000 });       // (1500 − 1000) × 2
    expect(edgePatch('in', 0, inPrecomp, 8000)).toEqual({ in: undefined });
    expect(edgePatch('out', 8000, row({ in: 0, out: 3000 }), 8000)).toEqual({ out: undefined });
    expect(edgePatch('out', 100, row({ in: 500, out: 3000 }), 8000)).toEqual({ out: 550 });   // never before in + 50
  });

  it('keeps markers where the MCP does — the page on screen, else the poster root — and drops an empty map', () => {
    const poster = { layers: [], markers: { a: 1 } } as unknown as DesignSpec;
    expect(withMarkers(poster, 0, { b: 2000, a: 0 }).markers).toEqual({ a: 0, b: 2000 });
    expect(withMarkers(poster, 0, {})).not.toHaveProperty('markers');
    const deck = { pages: [{ id: 'p1', layers: [] }, { id: 'p2', layers: [] }] } as unknown as DesignSpec;
    expect(withMarkers(deck, 1, { hook: 0 }).pages?.[1]?.markers).toEqual({ hook: 0 });
  });

  it('names a new marker and refuses a name a time could not refer to', () => {
    expect(freshMarkerName({ shot1: 0 })).toBe('shot2');
    expect(markerNameProblem('cta-200', {})).toContain('not ending in -digits');
    expect(markerNameProblem('hook', { hook: 0 })).toContain('already');
    expect(markerNameProblem('hook', { hook: 0 }, 'hook')).toBeNull();
  });
});

describe('timeline editing — the gestures', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  const title = { id: 'title', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, in: 1000, out: 3000 } as unknown as Layer;
  function mount(): { state: StateManager; body: HTMLElement; seek: ReturnType<typeof vi.fn> } {
    const state = new StateManager();
    state.set('design', { _protocol: 'design/v1', document: { width: 100, height: 100 }, layers: [title], markers: { hook: 0, cta: 5000 } } as unknown as DesignSpec, false);
    const body = document.createElement('div');
    const markers = (): Record<string, number> => markersOf(state.get().design, 0);
    body.innerHTML = markerStripHTML(markers(), 10000) + trackHTML(title, row({ in: 1000, out: 3000 }), 10000, 0);
    document.body.appendChild(body);
    // jsdom lays nothing out: give every ruler 1000 px so 1 px = 10 ms.
    for (const el of body.querySelectorAll<HTMLElement>('.tl-track-area, .tl-marker-area')) {
      el.getBoundingClientRect = (): DOMRect => ({ left: 0, width: 1000, top: 0, height: 20, right: 1000, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    }
    const seek = vi.fn();
    bindTimelineEdits(body, { state, duration: () => 10000, playhead: () => 0, rows: () => new Map([['title', row({ in: 1000, out: 3000 })]]),
      markers, preview: () => undefined, seek });
    return { state, body, seek };
  }
  const drag = (el: Element, from: number, to: number): void => {
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: from, pointerId: 1, bubbles: true, button: 0 }));
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: to, pointerId: 1, bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { clientX: to, pointerId: 1, bubbles: true }));
  };
  const field = (s: StateManager, k: string): unknown => (s.findLayer('title') as unknown as Record<string, unknown>)[k];

  it('drags a layer\'s in point, and back to the start removes it — one undo step each', () => {
    const { state, body } = mount();
    drag(body.querySelector('.tl-life-h[data-edge="in"]') as Element, 100, 150);
    expect(field(state, 'in')).toBe(1500);
    drag(body.querySelector('.tl-life-h[data-edge="in"]') as Element, 150, 2);
    expect(state.findLayer('title')).not.toHaveProperty('in');
    state.undo();
    expect(field(state, 'in')).toBe(1500);
  });

  it('drags a marker, jumps on a click, removes on right-click, adds on a double-click of the strip', () => {
    const { state, body, seek } = mount();
    const cta = body.querySelector('.tl-marker[data-name="cta"]') as Element;
    drag(cta, 500, 501);                                  // under 3 px: a click
    expect(seek).toHaveBeenCalledWith(5000);
    drag(cta, 500, 600);
    expect(state.get().design?.markers).toEqual({ hook: 0, cta: 6000 });
    cta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(state.get().design?.markers).toEqual({ hook: 0 });
    const strip = body.querySelector('.tl-marker-area') as HTMLElement;
    strip.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, bubbles: true }));
    const input = strip.querySelector('input') as HTMLInputElement;
    input.value = 'reveal';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(state.get().design?.markers).toEqual({ hook: 0, reveal: 3000 });
  });
});
