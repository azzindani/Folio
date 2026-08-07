import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireTouchGestures } from './touch-gestures';
import { StateManager } from './state';
import { RULER_SIZE } from './canvas-draw';

/** jsdom has no elementFromPoint; the double-tap fallback needs one. */
function stubElementFromPoint(el: Element): void {
  Object.defineProperty(document, 'elementFromPoint', { value: () => el, configurable: true });
}

/** jsdom has no Touch constructor — a plain object is enough for the handlers. */
function touchAt(x: number, y: number): Touch {
  return { clientX: x, clientY: y, identifier: 0 } as unknown as Touch;
}
function fire(el: HTMLElement, type: string, touches: Touch[], changed = touches): boolean {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: touches });
  Object.defineProperty(ev, 'changedTouches', { value: changed });
  Object.defineProperty(ev, 'target', { value: el, configurable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe('canvas touch gestures', () => {
  let pane: HTMLElement;
  let state: StateManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    pane = document.createElement('div');
    pane.className = 'canvas-area';
    pane.innerHTML = `<svg><rect data-layer-id="card"></rect></svg>`;
    document.body.appendChild(pane);
    state = new StateManager();
    state.set('zoom', 1, false);
    state.set('panX', 0, false);
    state.set('panY', 0, false);
    wireTouchGestures(pane, state);
  });

  const layer = (): HTMLElement => pane.querySelector('[data-layer-id]') as unknown as HTMLElement;

  it('pans the view on a one-finger drag over empty canvas', () => {
    fire(pane, 'touchstart', [touchAt(100, 100)]);
    fire(pane, 'touchmove', [touchAt(140, 170)]);
    fire(pane, 'touchend', [], [touchAt(140, 170)]);
    expect(state.get().panX).toBe(40);
    expect(state.get().panY).toBe(70);
  });

  it('leaves a one-finger drag on a LAYER to the existing drag path', () => {
    // Selecting and moving a layer already works through pointer events; panning
    // here would fight it and move both.
    const prevented = fire(layer(), 'touchstart', [touchAt(100, 100)]);
    fire(pane, 'touchmove', [touchAt(160, 160)]);
    expect(prevented).toBe(false);
    expect(state.get().panX).toBe(0);
    expect(state.get().panY).toBe(0);
  });

  it('pinches to zoom, anchored between the fingers', () => {
    fire(pane, 'touchstart', [touchAt(100, 200), touchAt(200, 200)]);
    fire(pane, 'touchmove', [touchAt(50, 200), touchAt(250, 200)]);   // 100px → 200px
    expect(state.get().zoom).toBeCloseTo(2, 5);
    // The design point under the midpoint must not drift: midpoint stayed at
    // 150, so panX must scale about it.
    const { panX, zoom } = state.get();
    const anchor = 150 - RULER_SIZE;
    expect((anchor - panX) / zoom).toBeCloseTo(anchor, 5);
  });

  it('clamps zoom to the canvas limits', () => {
    fire(pane, 'touchstart', [touchAt(100, 200), touchAt(200, 200)]);
    fire(pane, 'touchmove', [touchAt(-2000, 200), touchAt(2200, 200)]);
    expect(state.get().zoom).toBeLessThanOrEqual(5);
    fire(pane, 'touchend', [], []);
    fire(pane, 'touchstart', [touchAt(100, 200), touchAt(2100, 200)]);
    fire(pane, 'touchmove', [touchAt(1090, 200), touchAt(1110, 200)]);
    expect(state.get().zoom).toBeGreaterThanOrEqual(0.1);
  });

  it('prevents the browser default for pinch and pan, so the page cannot scroll too', () => {
    expect(fire(pane, 'touchstart', [touchAt(10, 10), touchAt(90, 10)])).toBe(true);
    expect(fire(pane, 'touchmove', [touchAt(5, 10), touchAt(95, 10)])).toBe(true);
  });

  it('opens the context menu on a long press', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    pane.addEventListener('contextmenu', e => seen.push(`${(e as MouseEvent).clientX},${(e as MouseEvent).clientY}`));
    fire(layer(), 'touchstart', [touchAt(120, 240)]);
    vi.advanceTimersByTime(520);
    expect(seen).toEqual(['120,240']);
    vi.useRealTimers();
  });

  it('cancels the long press once the finger moves', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    pane.addEventListener('contextmenu', () => seen.push('x'));
    fire(layer(), 'touchstart', [touchAt(120, 240)]);
    fire(pane, 'touchmove', [touchAt(160, 300)]);
    vi.advanceTimersByTime(520);
    expect(seen).toEqual([]);
    vi.useRealTimers();
  });

  it('synthesises dblclick on a double tap when the browser did not', async () => {
    const seen: string[] = [];
    document.addEventListener('dblclick', () => seen.push('dbl'));
    const el = layer();
    stubElementFromPoint(el as unknown as Element);
    fire(el, 'touchstart', [touchAt(100, 100)]);
    fire(el, 'touchend', [], [touchAt(100, 100)]);
    fire(el, 'touchstart', [touchAt(103, 102)]);
    fire(el, 'touchend', [], [touchAt(103, 102)]);
    await new Promise(r => setTimeout(r, 80));
    expect(seen).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('does NOT synthesise a second dblclick when the browser already fired one', async () => {
    const seen: string[] = [];
    document.addEventListener('dblclick', () => seen.push('dbl'));
    const el = layer();
    stubElementFromPoint(el as unknown as Element);
    fire(el, 'touchstart', [touchAt(100, 100)]);
    fire(el, 'touchend', [], [touchAt(100, 100)]);
    fire(el, 'touchstart', [touchAt(101, 101)]);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));   // the browser's own
    fire(el, 'touchend', [], [touchAt(101, 101)]);
    await new Promise(r => setTimeout(r, 80));
    expect(seen).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('treats two far-apart taps as separate taps, not a double tap', async () => {
    const seen: string[] = [];
    document.addEventListener('dblclick', () => seen.push('dbl'));
    const el = layer();
    fire(el, 'touchstart', [touchAt(100, 100)]);
    fire(el, 'touchend', [], [touchAt(100, 100)]);
    fire(el, 'touchstart', [touchAt(240, 260)]);
    fire(el, 'touchend', [], [touchAt(240, 260)]);
    await new Promise(r => setTimeout(r, 80));
    expect(seen).toHaveLength(0);
  });
});
