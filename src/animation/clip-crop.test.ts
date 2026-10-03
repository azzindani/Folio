import { describe, it, expect } from 'vitest';
import type { Layer } from '../schema/types';
import { baseCrop, cropAt, cropCss, hasCrop, panKeys, readCropArgs } from './clip-crop';

const clip = (video: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Layer =>
  ({ id: 'c', type: 'video', src: 'assets/video/c.mp4', x: 0, y: 0, width: 1080, height: 1920, video, ...extra }) as unknown as Layer;

describe('where a clip rests', () => {
  it('centred and unzoomed by default; video.focus/zoom when set, clamped', () => {
    expect(baseCrop(clip())).toEqual({ focus: [0.5, 0.5], zoom: 1 });
    expect(hasCrop(clip())).toBe(false);
    expect(baseCrop(clip({ focus: [0.2, 0.9], zoom: 9 }))).toEqual({ focus: [0.2, 0.9], zoom: 4 });
  });
  it('the older focal point keeps rendering in thirds, as it always did', () => {
    expect(baseCrop(clip({}, { focal: [0.2, 0.8] })).focus).toEqual([0, 1]);
    expect(baseCrop(clip({ focus: [0.3, 0.3] }, { focal: [0.9, 0.9] })).focus).toEqual([0.3, 0.3]);
  });
});

describe('a pan over the file clock', () => {
  const panned = clip({ zoom: 1.2, pan: [{ at_ms: 3000, focus: [1, 0.5], zoom: 2 }, { at_ms: 1000, focus: [0, 0.5] }, { at_ms: 5000 }] });
  it('keys sort by file time; a key without focus or zoom is dropped', () => {
    expect(panKeys(panned).map(k => k.at_ms)).toEqual([1000, 3000]);
  });
  it('holds before the first key and after the last; eases between; a key carries what it does not set', () => {
    expect(cropAt(panned, 0)).toEqual({ focus: [0, 0.5], zoom: 1.2 });
    expect(cropAt(panned, 9000)).toEqual({ focus: [1, 0.5], zoom: 2 });
    const mid = cropAt(panned, 2000);
    expect(mid.focus[0]).toBeCloseTo(0.5, 6);   // ease-in-out is symmetric about the middle
    expect(mid.zoom).toBeCloseTo(1.6, 6);
  });
  it('as CSS: aligned by object-position and enlarged about the same point', () => {
    expect(cropCss({ focus: [0.25, 1], zoom: 2 })).toBe('object-fit:cover;object-position:25% 100%;transform-origin:25% 100%;transform:scale(2)');
  });
});

describe('op:video arguments', () => {
  it('checks ranges and file-clock keys; null clears', () => {
    expect(readCropArgs({ focus: [0.5, 0.2], zoom: 1.5 })).toEqual({ focus: [0.5, 0.2], zoom: 1.5 });
    expect(readCropArgs({ focus: null, pan: null })).toEqual({ focus: null, pan: null });
    expect(readCropArgs({ focus: [2, 0] })).toContain('0–1');
    expect(readCropArgs({ zoom: 0.5 })).toContain('1–4');
    expect(readCropArgs({ pan: [{ focus: [0, 0] }] })).toContain('at_ms');
    expect(readCropArgs({ pan: [{ at_ms: 100 }] })).toContain('neither');
    expect(readCropArgs({ pan: [{ at_ms: 900, zoom: 2 }, { at_ms: 100, focus: [0, 0] }] })).toEqual({ pan: [{ at_ms: 100, focus: [0, 0] }, { at_ms: 900, zoom: 2 }] });
  });
});
