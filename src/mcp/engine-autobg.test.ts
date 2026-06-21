import { describe, it, expect } from 'vitest';
import { isFullCanvasBgRect, hasFullCanvasBackdrop, hasRenderableContent } from './engine-layer-tools';
import type { Layer } from '../schema/types';

const W = 1080, H = 1350;
const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;

describe('auto-bg detection — guarantee a canvas ground (suite-022/042 white-void)', () => {
  it('recognizes a full-canvas rect by hex, $token, or bare color:', () => {
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#101010' } }), W, H)).toBe(true);
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: '#FAF5EC' }), W, H)).toBe(true);
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: { color: '$surface' } }), W, H)).toBe(true);
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, color: '#222' }), W, H)).toBe(true);
    // background/backdrop type fills the page regardless of dims
    expect(isFullCanvasBgRect(L({ type: 'background', fill: '#0A0A0A' }), W, H)).toBe(true);
    // a GRADIENT fill is a backdrop too (a composed-preset bg) — else a redundant
    // auto-bg gets stacked on the preset and breaks the sole-preset seal re-fit
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: { type: 'linear', stops: [{ color: '#14100A' }, { color: '#805A05' }] } }), W, H)).toBe(true);
  });

  it('rejects a partial rect, an unfilled rect, and non-rect shapes', () => {
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 100, y: 100, width: 400, height: 400, fill: '#000' }), W, H)).toBe(false);
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: 'none' }), W, H)).toBe(false);
    expect(isFullCanvasBgRect(L({ type: 'rect', x: 0, y: 0, width: W, height: H }), W, H)).toBe(false);
    expect(isFullCanvasBgRect(L({ type: 'text', x: 0, y: 0, width: W, height: H, fill: '#000' }), W, H)).toBe(false);
  });

  it('finds a backdrop nested one level inside a preset group', () => {
    const grp = L({ type: 'group', x: 0, y: 0, width: W, height: H, layers: [
      L({ type: 'rect', x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#14100A' } }),
      L({ type: 'text', x: 80, y: 80, width: 400, height: 60, content: { type: 'plain', value: 'Hi' } }),
    ] });
    expect(hasFullCanvasBackdrop([grp], W, H)).toBe(true);
  });

  it('reports NO backdrop when a poster has only loose text (the white-void case)', () => {
    const layers = [
      L({ type: 'text', x: 80, y: 200, width: 920, height: 80, content: { type: 'plain', value: 'Noir Season' } }),
      L({ type: 'text', x: 80, y: 300, width: 920, height: 40, content: { type: 'plain', value: 'Four Fridays' } }),
    ];
    expect(hasFullCanvasBackdrop(layers, W, H)).toBe(false);
    expect(hasRenderableContent(layers)).toBe(true);        // → engine paints the theme ground
  });

  it('hasRenderableContent is false for an empty scaffold / blank-value text (left to the model)', () => {
    expect(hasRenderableContent([])).toBe(false);
    expect(hasRenderableContent([L({ type: 'text', content: { type: 'plain', value: '   ' } })])).toBe(false);
    expect(hasRenderableContent([L({ type: 'image', src: 'x.png' })])).toBe(true);
  });
});
