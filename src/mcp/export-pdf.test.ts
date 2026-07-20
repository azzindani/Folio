import { describe, it, expect } from 'vitest';
import { collectHrefRects } from './engine';
import { documentDpi } from './engine-export-tools';
import type { Layer } from '../schema/types';

describe('collectHrefRects (PDF link annotations)', () => {
  it('collects rects from top-level hyperlinked layers', () => {
    const layers = [
      { id: 'a', type: 'text', x: 10, y: 20, width: 100, height: 30, href: 'https://x.test' },
      { id: 'b', type: 'rect', x: 0, y: 0, width: 50, height: 50 },
    ] as unknown as Layer[];
    expect(collectHrefRects(layers)).toEqual([{ x: 10, y: 20, w: 100, h: 30, href: 'https://x.test' }]);
  });

  it('recurses into groups (children are absolute-positioned)', () => {
    const layers = [
      { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500, layers: [
        { id: 'c', type: 'text', x: 40, y: 60, width: 200, height: 24, href: 'https://deep.test' },
      ] },
    ] as unknown as Layer[];
    expect(collectHrefRects(layers)).toEqual([{ x: 40, y: 60, w: 200, h: 24, href: 'https://deep.test' }]);
  });

  it('skips layers with no href, blank href, or zero size', () => {
    const layers = [
      { id: 'a', type: 'text', x: 1, y: 1, width: 10, height: 10 },
      { id: 'b', type: 'text', x: 1, y: 1, width: 10, height: 10, href: '   ' },
      { id: 'c', type: 'text', x: 1, y: 1, width: 0, height: 10, href: 'https://zero.test' },
    ] as unknown as Layer[];
    expect(collectHrefRects(layers)).toEqual([]);
  });
});

describe('documentDpi (PDF physical page size)', () => {
  const pageMm = (px: number, dpi: number): number => (px * 72) / dpi / 72 * 25.4;

  it('defaults to 96 dpi when the field is absent or junk', () => {
    expect(documentDpi({})).toBe(96);
    expect(documentDpi({ document: {} })).toBe(96);
    expect(documentDpi({ document: { dpi: 0 } })).toBe(96);
    expect(documentDpi({ document: { dpi: -1 } })).toBe(96);
    expect(documentDpi({ document: { dpi: 'nonsense' } })).toBe(96);
  });

  it('honors an explicit print dpi', () => {
    expect(documentDpi({ document: { dpi: 150 } })).toBe(150);
    expect(documentDpi({ document: { dpi: 300 } })).toBe(300);
    expect(documentDpi({ document: { dpi: '150' } })).toBe(150);   // patch_design writes strings
  });

  // The bug: an A2 poster drawn at 150 dpi used to export as a 656×928 mm page
  // (right shape, 1.56× too big) because the converter assumed 96 dpi.
  it('puts a 2480x3508 canvas on an exact A2 page at 150 dpi', () => {
    const dpi = documentDpi({ document: { dpi: 150 } });
    expect(pageMm(2480, dpi)).toBeCloseTo(420, 0);   // A2 width  420 mm
    expect(pageMm(3508, dpi)).toBeCloseTo(594, 0);   // A2 height 594 mm
  });

  it('still sizes a screen design at 96 dpi as before', () => {
    const dpi = documentDpi({ document: { dpi: 96 } });
    expect((1080 * 72) / dpi).toBeCloseTo(810, 1);   // 1080px → 810pt, unchanged
  });
});
