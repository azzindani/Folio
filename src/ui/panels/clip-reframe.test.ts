import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import type { ClipLayer } from '../../animation/video-clip';
import { cropEdit, addKeyEdit, dragCrop, KEY_SNAP_MS } from './clip-reframe';

const clip = (video: Record<string, unknown> = {}): ClipLayer =>
  ({ id: 'c', type: 'video', z: 1, in: 0, out: 4000, src: 'assets/video/c.mp4', video: { offset_ms: 1000, duration_ms: 4000, ...video } }) as unknown as ClipLayer;
const centre = { focus: [0.5, 0.5] as [number, number], zoom: 1 };

describe('cropEdit — where a reframe is written', () => {
  it('with no keys it sets the resting crop, and back at the centre it leaves the file', () => {
    expect(cropEdit(clip() as Layer, { focus: [0.2, 0.8], zoom: 1.5 }, 2000)).toEqual({ focus: [0.2, 0.8], zoom: 1.5 });
    expect(cropEdit(clip() as Layer, centre, 2000)).toEqual({ focus: null, zoom: null });
    // Only what differs from the default is written.
    expect(cropEdit(clip() as Layer, { focus: [0.2, 0.5], zoom: 1 }, 2000)).toEqual({ focus: [0.2, 0.5], zoom: null });
    expect(cropEdit(clip() as Layer, { focus: [0.5, 0.5], zoom: 2 }, 2000)).toEqual({ focus: null, zoom: 2 });
  });
  it('rounds and clamps what a drag produces', () => {
    expect(cropEdit(clip() as Layer, { focus: [-0.2, 1.7], zoom: 9 }, 0)).toEqual({ focus: [0, 1], zoom: 4 });
    expect(cropEdit(clip() as Layer, { focus: [0.123456, 0.5], zoom: 1.23456 }, 0)).toEqual({ focus: [0.1235, 0.5], zoom: 1.2346 });
  });
  it('with keys it writes the key at the playhead: replacing one within a few frames, else adding in order', () => {
    const keyed = clip({ pan: [{ at_ms: 1000, focus: [0, 0], zoom: 1 }, { at_ms: 3000, focus: [1, 1], zoom: 2 }] });
    expect(cropEdit(keyed as Layer, { focus: [0.5, 0.5], zoom: 1.4 }, 2000).pan).toEqual([
      { at_ms: 1000, focus: [0, 0], zoom: 1 }, { at_ms: 2000, focus: [0.5, 0.5], zoom: 1.4 }, { at_ms: 3000, focus: [1, 1], zoom: 2 }]);
    expect(cropEdit(keyed as Layer, { focus: [0.3, 0.3], zoom: 1 }, 3000 + KEY_SNAP_MS - 1).pan).toEqual([
      { at_ms: 1000, focus: [0, 0], zoom: 1 }, { at_ms: 3039, focus: [0.3, 0.3], zoom: 1 }]);
  });
});

describe('addKeyEdit — ◆ Key here', () => {
  it('the first key also pins the clip\'s start, so the move runs from the look it had', () => {
    const resting = clip({ focus: [0.2, 0.4], zoom: 1.5 });
    expect(addKeyEdit(resting, 3000).pan).toEqual([
      { at_ms: 1000, focus: [0.2, 0.4], zoom: 1.5 }, { at_ms: 3000, focus: [0.2, 0.4], zoom: 1.5 }]);
    expect(addKeyEdit(resting, 1010).pan).toEqual([{ at_ms: 1010, focus: [0.2, 0.4], zoom: 1.5 }]);
  });
  it('a later key keeps the crop showing at that moment, between the keys it eases through', () => {
    const keyed = clip({ pan: [{ at_ms: 1000, focus: [0, 0.5], zoom: 1 }, { at_ms: 3000, focus: [1, 0.5], zoom: 1 }] });
    const added = addKeyEdit(keyed, 2000).pan ?? [];
    expect(added.map(k => k.at_ms)).toEqual([1000, 2000, 3000]);
    expect(added[1]?.focus?.[0]).toBeCloseTo(0.5, 3);
  });
});

describe('dragCrop — the picture follows the pointer', () => {
  // A 1920×1080 frame in a 540×960 box: cover scales it 0.8889×, the picture is 1706 px wide — 1166 px of overflow.
  const box = { w: 540, h: 960 }, frame = { w: 1920, h: 1080 };
  it('dragging right shows more of the left: the focus moves against the pointer, by dx over the overflow', () => {
    const c = dragCrop(centre, 116.6, 0, box, frame);
    expect(c.focus[0]).toBeCloseTo(0.4, 3);
    expect(c.focus[1]).toBe(0.5);
  });
  it('an axis with no overflow does not move, zoom makes overflow, and the focus stops at the edges', () => {
    expect(dragCrop(centre, 0, 300, box, frame).focus[1]).toBe(0.5);
    expect(dragCrop({ focus: [0.5, 0.5], zoom: 2 }, 0, 192, box, frame).focus[1]).toBeCloseTo(0.3, 3);
    expect(dragCrop(centre, 5000, 0, box, frame).focus[0]).toBe(0);
    expect(dragCrop(centre, -5000, 0, box, frame).focus[0]).toBe(1);
  });
});
