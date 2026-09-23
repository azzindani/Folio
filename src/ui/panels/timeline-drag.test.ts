import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AnimationSpec } from '../../animation/types';
import type { Layer } from '../../schema/types';
import type { RowTiming } from '../../editor/motion-pose';
import { retimeKeyframe, moveTrack, bindTimelineDrags } from './timeline-drag';
import { trackHTML } from './timeline-track-view';

const track = (): AnimationSpec => ({
  keyframes: [{ t: 0, opacity: 0, y: 26 }, { t: 480, opacity: 1, y: 0 }, { t: 3000, opacity: 1 }, { t: 3450, opacity: 0 }],
  playback: { delay: 1200, duration: 4000, origin: 'offset' },
} as unknown as AnimationSpec);
const scene = (a: AnimationSpec): number[] => (a.keyframes ?? []).map(k => (a.playback?.delay ?? 0) + k.t - Math.min(...(a.keyframes ?? []).map(x => x.t)));

describe('retimeKeyframe', () => {
  it('moves one keyframe and leaves the others where they play', () => {
    expect(scene(retimeKeyframe(track(), 1, 2000, []))).toEqual([1200, 2000, 4200, 4650]);
  });

  it('moves the first keyframe alone — the track no longer shifts with it — and keeps the hold at the end', () => {
    const a = retimeKeyframe(track(), 0, 1500, []);
    expect(scene(a)).toEqual([1500, 1680, 4200, 4650]);
    // A 4000 ms track whose keys span 3450 held 550 ms at the end; it still does.
    expect(a.playback?.duration).toBe(4650 - 1500 + 550);
  });

  it('keeps the keyframes in order, and plays through a precomp clock', () => {
    expect(scene(retimeKeyframe(track(), 1, 9000, []))[1]).toBe(4199);
    // A precomp starting at 2000: scene 3000 is its local 1000.
    const clocks = [{ start: 2000, speed: 1 }] as never;
    expect(scene(retimeKeyframe({ keyframes: [{ t: 0, x: 0 }, { t: 500, x: 9 }], playback: { delay: 0 } } as never, 1, 3000, clocks))).toEqual([0, 1000]);
  });
});

describe('moveTrack', () => {
  it('moves all of a layer\'s motion so its first keyframe plays at the time dropped', () => {
    expect(scene(moveTrack(track(), 2500, []))).toEqual([2500, 2980, 5500, 5950]);
  });
});

describe('the drag gestures', () => {
  const anim = (): AnimationSpec => ({ keyframes: [{ t: 0, x: 0 }, { t: 500, x: 90 }, { t: 1000, x: 0 }], playback: { delay: 1000, duration: 1000 } } as unknown as AnimationSpec);
  const layer = { id: 'dot', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, animation: anim() } as unknown as Layer;
  const timing = (): RowTiming => ({ keys: [1000, 1500, 2000], ghosts: [], start: 1000, end: 2000, loop: false, window: null, link: null, clocks: [] });

  function mount(beats?: number[]): { body: HTMLElement; write: ReturnType<typeof vi.fn> } {
    const body = document.createElement('div');
    body.innerHTML = trackHTML(layer, timing(), 10000, 0);
    document.body.appendChild(body);
    // jsdom lays nothing out: 1000 px of ruler, so 1 px = 10 ms.
    body.querySelectorAll<HTMLElement>('.tl-track-area').forEach(el => {
      el.getBoundingClientRect = (): DOMRect => ({ left: 0, width: 1000, top: 0, height: 32, right: 1000, bottom: 32, x: 0, y: 0, toJSON: () => ({}) });
    });
    const bar = body.querySelector<HTMLElement>('.tl-bar');
    if (bar) bar.getBoundingClientRect = (): DOMRect => ({ left: 100, width: 100, top: 0, height: 12, right: 200, bottom: 12, x: 100, y: 0, toJSON: () => ({}) });
    const write = vi.fn();
    bindTimelineDrags(body, { duration: () => 10000, playhead: () => 0, rows: () => new Map([['dot', timing()]]), markers: () => ({ cta: 3000 }),
      preview: () => undefined, animationOf: () => anim(), write, ...(beats ? { beats: () => beats } : {}) });
    return { body, write };
  }
  const drag = (el: Element, from: number, to: number): void => {
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: from, pointerId: 1, bubbles: true, button: 0 }));
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: to, pointerId: 1, bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { clientX: to, pointerId: 1, bubbles: true }));
  };
  afterEach(() => { document.body.innerHTML = ''; });

  it('retimes the keyframe dragged, and a drag near a marker lands on it', () => {
    const { body, write } = mount();
    const middle = body.querySelectorAll('.tl-keyframe')[1];
    if (middle) drag(middle, 150, 181);   // 1810 ms: nearer 1810 than any snap
    expect(scene(write.mock.calls[0]?.[1] as AnimationSpec)).toEqual([1000, 1810, 2000]);
    const last = body.querySelectorAll('.tl-keyframe')[2];
    if (last) drag(last, 200, 297);       // within 6 px of the marker at 3000
    expect(scene(write.mock.calls[1]?.[1] as AnimationSpec)).toEqual([1000, 1500, 3000]);
  });

  it('lands a keyframe on a beat of the soundtrack', () => {
    const { body, write } = mount([1750]);
    const middle = body.querySelectorAll('.tl-keyframe')[1];
    if (middle) drag(middle, 150, 179);   // 1790 ms, within 6 px of the beat at 1750
    expect(scene(write.mock.calls[0]?.[1] as AnimationSpec)).toEqual([1000, 1750, 2000]);
  });

  it('moves a whole layer by its bar, dropped by its start wherever it was held, and a tap is not a drag', () => {
    const { body, write } = mount();
    const bar = body.querySelector('.tl-bar');
    if (bar) drag(bar, 150, 250);         // held 50 px in; start 100 → 200 px = 2000 ms
    expect(scene(write.mock.calls[0]?.[1] as AnimationSpec)).toEqual([2000, 2500, 3000]);
    const k = body.querySelector('.tl-keyframe');
    if (k) drag(k, 100, 101);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('a loop written out as keys', () => {
  it('draws as one band from the key it leaves to its last repeat, with no diamond per repeat', () => {
    const anim = { keyframes: [{ t: 0, y: 40 }, { t: 400, y: 0 }, { t: 700, y: 12 }, { t: 1000, y: 0 },
      { t: 1300, y: 12, ambient: true }, { t: 1600, y: 0, ambient: true }, { t: 1900, y: 12, ambient: true }, { t: 2200, y: 0, ambient: true }],
      playback: { duration: 2200, origin: 'offset' } } as unknown as AnimationSpec;
    const layer = { id: 'ball', type: 'ellipse', z: 1, x: 0, y: 0, width: 10, height: 10, animation: anim } as unknown as Layer;
    const html = trackHTML(layer, undefined, 2200, 0);
    const box = document.createElement('div');
    box.innerHTML = html;
    expect([...box.querySelectorAll('.tl-keyframe')].map(k => k.getAttribute('data-i'))).toEqual(['0', '1', '2', '3']);
    const band = box.querySelector<HTMLElement>('.tl-loop-band');
    expect(band?.style.left).toBe(`${(1000 / 2200) * 100}%`);
    expect(band?.getAttribute('title')).toMatch(/repeats 1\.000s–2\.200s — a loop written as 4 keys/);
  });
});
