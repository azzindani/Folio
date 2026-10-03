import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindPinch } from './timeline-gestures';

const touch = (type: string, pts: Array<[number, number]>): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { touches: pts.map(([clientX, clientY]) => ({ clientX, clientY })) });
  return e;
};

let body: HTMLElement;
const calls: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  calls.length = 0;
  body = document.createElement('div');
  body.getBoundingClientRect = () => ({ left: 10, top: 0, right: 410, bottom: 100, width: 400, height: 100, x: 10, y: 0, toJSON: () => ({}) });
  bindPinch(body, {
    labelW: 120,
    scale: () => 0.1,
    begin: () => calls.push('begin'),
    end: () => calls.push('end'),
    setScale: (px, anchor) => calls.push(`scale ${px.toFixed(3)} @${Math.round(anchor)}`),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('pinch on the timeline sheet', () => {
  it('two fingers begin it, the distance between them scales it about their midpoint, lifting them ends it', () => {
    body.dispatchEvent(touch('touchstart', [[100, 50], [200, 50]]));
    body.dispatchEvent(touch('touchmove', [[50, 50], [250, 50]]));      // 100 px apart → 200: ×2, midpoint 150 → 140 in the body → 20 past the labels
    vi.runAllTimers();
    body.dispatchEvent(touch('touchend', []));
    expect(calls).toEqual(['begin', 'scale 0.200 @20', 'end']);
  });

  it('a frame carries only the latest move; one finger is the browser\'s to pan with', () => {
    body.dispatchEvent(touch('touchstart', [[100, 50]]));
    body.dispatchEvent(touch('touchmove', [[120, 50]]));
    vi.runAllTimers();
    expect(calls).toEqual([]);
    body.dispatchEvent(touch('touchstart', [[100, 50], [200, 50]]));
    body.dispatchEvent(touch('touchmove', [[90, 50], [210, 50]]));
    body.dispatchEvent(touch('touchmove', [[50, 50], [250, 50]]));
    vi.runAllTimers();
    expect(calls).toEqual(['begin', 'scale 0.200 @20']);
  });

  it('lifting before the frame redraws once at the end and never applies a stale move', () => {
    body.dispatchEvent(touch('touchstart', [[100, 50], [200, 50]]));
    body.dispatchEvent(touch('touchmove', [[50, 50], [250, 50]]));
    body.dispatchEvent(touch('touchend', []));
    vi.runAllTimers();
    expect(calls).toEqual(['begin', 'end']);
    body.dispatchEvent(touch('touchend', []));
    expect(calls).toEqual(['begin', 'end']);
  });
});
