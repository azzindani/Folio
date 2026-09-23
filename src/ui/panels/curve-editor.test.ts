import { describe, it, expect, vi, afterEach } from 'vitest';
import { bezierFor, bezierString, toPlot, fromPlot, bindCurveEditor, type CurveBox } from './curve-editor';
import { openEasePopover } from './ease-popover';
import { resolveEasing } from '../../animation/easing';

const BOX: CurveBox = { w: 168, h: 140, pad: 14 };
const drag = (el: Element, target: Element, to: [number, number]): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, bubbles: true, button: 0 }));
  target.dispatchEvent(new PointerEvent('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1, bubbles: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { clientX: to[0], clientY: to[1], pointerId: 1, bubbles: true }));
};
/** Mount the editor with its svg drawn at `scale` × its own size, at the page origin. */
function mount(name: string, scale = 1): { host: HTMLElement; svg: SVGSVGElement; commit: ReturnType<typeof vi.fn> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const commit = vi.fn();
  bindCurveEditor(host, name, BOX, commit);
  const svg = host.querySelector('svg.tl-bez') as SVGSVGElement;
  svg.getBoundingClientRect = (): DOMRect => ({ left: 0, top: 0, width: BOX.w * scale, height: BOX.h * scale, right: BOX.w * scale, bottom: BOX.h * scale, x: 0, y: 0, toJSON: () => ({}) });
  return { host, svg, commit };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('the curve an easing is', () => {
  it('reads a cubic-bezier as written, a named easing as the bezier the editor plays it with, and the default as ease-in-out', () => {
    expect(bezierFor('cubic-bezier(0.2, 0.8, 0.4, 1)')).toEqual([0.2, 0.8, 0.4, 1]);
    expect(bezierFor('ease-out-back')).toEqual([0.34, 1.56, 0.64, 1]);
    expect(bezierFor('')).toEqual([0.42, 0, 0.58, 1]);
    expect(bezierFor('linear')).toEqual([0, 0, 1, 1]);
    expect(bezierFor('bounce').every(Number.isFinite)).toBe(true);
  });

  it('writes a string the engine evaluates: time kept in 0..1, two decimals', () => {
    const s = bezierString([1.3, 1.234, -0.2, 0.5]);
    expect(s).toBe('cubic-bezier(1, 1.23, 0, 0.5)');
    expect(resolveEasing(s)(0.5)).toBeGreaterThan(0);
  });

  it('maps a point to the plot and back', () => {
    const [x, y] = toPlot(0.3, 1.2, BOX);
    const [t, v] = fromPlot(x, y, BOX);
    expect(t).toBeCloseTo(0.3, 6);
    expect(v).toBeCloseTo(1.2, 6);
    expect(fromPlot(-50, 9999, BOX)).toEqual([0, -0.6]);
  });
});

describe('shaping a curve by its handles', () => {
  it('drags the first handle to where the pointer is, keeps the second, and commits on release', () => {
    const { svg, commit } = mount('ease-out-back');
    const [x, y] = toPlot(0.2, 1.3, BOX);
    const h1 = svg.querySelector('.tl-bez-h[data-h="1"]');
    if (h1) drag(h1, svg, [x, y]);
    expect(commit).toHaveBeenCalledWith('cubic-bezier(0.2, 1.3, 0.64, 1)');
    expect(svg.querySelector('.tl-bez-h[data-h="1"]')?.getAttribute('cx')).toBe(x.toFixed(1));
    expect(svg.querySelector('.tl-bez-label')?.textContent).toBe('0.2, 1.3, 0.64, 1');
  });

  it('reads the pointer in the svg\'s own units when the panel is zoomed, and a tap commits nothing', () => {
    const { svg, commit } = mount('linear', 2);
    const [x, y] = toPlot(0.5, 0.9, BOX);
    const h2 = svg.querySelector('.tl-bez-h[data-h="2"]');
    if (h2) drag(h2, svg, [x * 2, y * 2]);
    expect(commit).toHaveBeenLastCalledWith('cubic-bezier(0, 0, 0.5, 0.9)');
    const h1 = svg.querySelector('.tl-bez-h[data-h="1"]');
    h1?.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true }));
    svg.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }));
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('the easing popover', () => {
  function open(current: string): { host: HTMLElement; commit: ReturnType<typeof vi.fn> } {
    const host = document.createElement('div'), anchor = document.createElement('div');
    host.appendChild(anchor);
    document.body.appendChild(host);
    const commit = vi.fn();
    openEasePopover({ anchor, host, current, commit });
    return { host, commit };
  }

  it('stays open after a handle is dragged, and lists the shaped curve as the keyframe\'s easing', () => {
    const { host, commit } = open('ease-out');
    const svg = host.querySelector('svg.tl-bez') as SVGSVGElement;
    svg.getBoundingClientRect = (): DOMRect => ({ left: 0, top: 0, width: BOX.w, height: BOX.h, right: BOX.w, bottom: BOX.h, x: 0, y: 0, toJSON: () => ({}) });
    const [x, y] = toPlot(0.1, 0.9, BOX);
    const h1 = svg.querySelector('.tl-bez-h[data-h="1"]');
    if (h1) drag(h1, svg, [x, y]);
    expect(commit).toHaveBeenCalledWith(expect.stringMatching(/^cubic-bezier\(0\.1, 0\.9, /));
    expect(host.querySelectorAll('.tl-ease-pop')).toHaveLength(1);
    expect(host.querySelector<HTMLSelectElement>('.tl-ease-picker')?.value).toMatch(/^cubic-bezier\(0\.1, 0\.9, /);
  });

  it('opens under the keyframe but inside a narrow panel', () => {
    const host = document.createElement('div'), anchor = document.createElement('div');
    host.appendChild(anchor);
    document.body.appendChild(host);
    Object.defineProperty(host, 'clientWidth', { value: 300 });
    anchor.getBoundingClientRect = (): DOMRect => ({ left: 220, top: 40, width: 10, height: 10, right: 230, bottom: 50, x: 220, y: 40, toJSON: () => ({}) });
    openEasePopover({ anchor, host, current: '', commit: vi.fn() });
    expect(host.querySelector<HTMLElement>('.tl-ease-pop')?.style.left).toBe(`${300 - BOX.w - 4}px`);
  });

  it('commits a picked name and closes; a press outside closes without writing', () => {
    const a = open('');
    const sel = a.host.querySelector<HTMLSelectElement>('.tl-ease-picker');
    if (sel) { sel.value = 'bounce'; sel.dispatchEvent(new Event('change')); }
    expect(a.commit).toHaveBeenCalledWith('bounce');
    expect(a.host.querySelectorAll('.tl-ease-pop')).toHaveLength(0);
    const b = open('ease-in');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(b.host.querySelectorAll('.tl-ease-pop')).toHaveLength(0);
    expect(b.commit).not.toHaveBeenCalled();
  });
});
