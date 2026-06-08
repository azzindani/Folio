import { describe, it, expect } from 'vitest';
import { collectHrefRects } from './engine';
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
