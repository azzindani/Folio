import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { TimelinePanelManager } from './timeline-panel';
import type { DesignSpec, Layer } from '../../schema/types';

const design = (): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 100, height: 100, unit: 'px', dpi: 96 },
  layers: [
    { id: 'a', type: 'video', z: 1, x: 0, y: 0, width: 100, height: 100, src: 'assets/video/a.mp4', in: 0, out: 3000, video: { offset_ms: 0, duration_ms: 3000 } },
    { id: 't', type: 'text', z: 2, x: 0, y: 0, width: 50, height: 20, content: { value: 'hi' }, animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 800, opacity: 1 }] } },
  ] as unknown as Layer[],
}) as unknown as DesignSpec;

let host: HTMLElement, state: StateManager;
const sheet = (): HTMLElement => host.querySelector('.tl-sheet') as HTMLElement;
const click = (id: string): void => (host.querySelector(id) as HTMLElement).click();

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeEach(() => {
  // jsdom lays nothing out: give the scroller a width, so the ruler has room for labels and Fit means something.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).id === 'tl-body' ? 600 : 0; } });
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
  state = new StateManager();
  state.set('design', design(), false);
  host = document.createElement('div');
  document.body.appendChild(host);
  new TimelinePanelManager(host, state);
});
afterEach(() => {
  host.remove();
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
});

describe('the timeline as one sheet', () => {
  it('draws a ruler on top, labels that stick, and the playhead as a line through the rows', () => {
    expect(sheet().firstElementChild?.classList.contains('tl-ruler-row')).toBe(true);
    expect(host.querySelectorAll('.tl-ruler-row .tl-tick-label').length).toBeGreaterThan(1);
    expect(host.querySelectorAll('.tl-scrub-area').length).toBe(1);
    expect(host.querySelectorAll('.tl-track .tl-label').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('.tl-sheet > .tl-scrub-thumb')).not.toBeNull();
    expect(sheet().style.getPropertyValue('--tl-w')).toBe('120px');
  });

  it('+ widens the sheet in px, Fit puts it back to the view', () => {
    expect(sheet().style.width).toBe('100%');
    click('#tl-zoom-in');
    const wide = parseInt(sheet().style.width, 10);
    expect(sheet().style.width).toMatch(/px$/);
    click('#tl-zoom-in');
    expect(parseInt(sheet().style.width, 10)).toBeGreaterThan(wide);
    click('#tl-zoom-out'); click('#tl-zoom-out'); click('#tl-zoom-out');
    expect(sheet().style.width).toBe('100%');
    click('#tl-zoom-in'); click('#tl-zoom-fit');
    expect(sheet().style.width).toBe('100%');
  });

  it('Ctrl + wheel zooms about the pointer; a plain wheel scrolls and is left alone', () => {
    const body = host.querySelector('#tl-body') as HTMLElement;
    const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    body.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(sheet().style.width).toBe('100%');
    const pinch = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    body.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(sheet().style.width).toMatch(/px$/);
  });

  it('a press on the ruler moves the playhead and survives the redraw; dragging carries it', () => {
    const area = host.querySelector('.tl-scrub-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24, x: 0, y: 0, toJSON: () => ({}) });
    area.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, button: 0, bubbles: true, cancelable: true }));
    const half = Number(sheet().style.getPropertyValue('--tl-p'));
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    area.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, bubbles: true }));
    expect(Number(sheet().style.getPropertyValue('--tl-p'))).toBeLessThan(0.2);
    expect(area.classList.contains('tl-dragging'), 'a drag on the ruler is not marked, so a redraw can replace it').toBe(true);
    area.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(area.classList.contains('tl-dragging')).toBe(false);
    area.dispatchEvent(new PointerEvent('pointermove', { clientX: 190, bubbles: true }));
    expect(Number(sheet().style.getPropertyValue('--tl-p'))).toBeLessThan(0.2);
  });
});

describe('the sequence and the selection', () => {
  const rowsOf = (): string[] => Array.from(host.querySelectorAll('.tl-track .tl-label')).map(l => (l as HTMLElement).dataset['layerId'] ?? '');

  it('shows every layer that plays in time, whatever is selected; the selection is highlighted', () => {
    expect(rowsOf()).toEqual(['a', 't']);
    state.set('selectedLayerIds', ['t'], false);
    expect(rowsOf()).toEqual(['a', 't']);
    const lit = Array.from(host.querySelectorAll('.tl-label.tl-selected')).map(l => (l as HTMLElement).dataset['layerId']);
    expect(lit).toEqual(['t']);
  });

  it('"Selected only" brings back the old filter', () => {
    state.set('selectedLayerIds', ['t'], false);
    const only = host.querySelector('#tl-selected-only') as HTMLInputElement;
    only.checked = true; only.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowsOf()).toEqual(['t']);
    only.checked = false; only.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowsOf()).toEqual(['a', 't']);
  });

  it('a row\'s name selects its layer; Shift adds, and again takes it out; a clip block selects too', () => {
    (host.querySelector('.tl-label[data-layer-id="a"]') as HTMLElement).click();
    expect(state.get().selectedLayerIds).toEqual(['a']);
    (host.querySelector('.tl-label[data-layer-id="t"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(state.get().selectedLayerIds).toEqual(['a', 't']);
    (host.querySelector('.tl-label[data-layer-id="a"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(state.get().selectedLayerIds).toEqual(['t']);
    (host.querySelector('.tl-clip[data-layer-id="a"]') as HTMLElement).click();
    expect(state.get().selectedLayerIds).toEqual(['a']);
  });

  it('the ⋯ button opens the options row (duration, stagger, trails)', () => {
    const opts = host.querySelector('#tl-options') as HTMLElement;
    expect(opts.hidden).toBe(true);
    click('#tl-options-toggle');
    expect(opts.hidden).toBe(false);
    expect((host.querySelector('#tl-options-toggle') as HTMLElement).getAttribute('aria-expanded')).toBe('true');
    click('#tl-options-toggle');
    expect(opts.hidden).toBe(true);
  });
});

describe('a pinch does not rebuild the sheet under the fingers', () => {
  it('resizes the same sheet while the fingers are down, and redraws it once they lift', async () => {
    const body = host.querySelector('#tl-body') as HTMLElement;
    const touch = (type: string, pts: Array<[number, number]>): Event => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { touches: pts.map(([clientX, clientY]) => ({ clientX, clientY })) });
      return e;
    };
    await new Promise(r => setTimeout(r, 120));   // the sampler loads after the panel and redraws it once: let that settle
    const first = sheet();
    body.dispatchEvent(touch('touchstart', [[200, 50], [260, 50]]));
    body.dispatchEvent(touch('touchmove', [[150, 50], [310, 50]]));
    await new Promise(r => setTimeout(r, 30));
    expect(sheet()).toBe(first);
    expect(first.style.width).toMatch(/px$/);
    expect(parseInt(first.style.width, 10)).toBeGreaterThan(600);
    body.dispatchEvent(touch('touchend', []));
    expect(sheet()).not.toBe(first);
    expect(sheet().style.width).toMatch(/px$/);
  });
});

describe('a zoom survives the scene turning out longer', () => {
  it('keeps the sheet\'s width when the scene length changes under it', () => {
    click('#tl-zoom-in'); click('#tl-zoom-in');
    const before = parseInt(sheet().style.width, 10);
    expect(before).toBeGreaterThan(700);
    // A layer that plays to 9 s: the scene was 3 s.
    const d = design();
    (d.layers as unknown as Array<Record<string, unknown>>).push({ id: 'late', type: 'rect', z: 3, x: 0, y: 0, width: 10, height: 10, in: 0, out: 9000 });
    state.set('design', d, false);
    expect(parseInt(sheet().style.width, 10)).toBe(before);
  });
});
