import { describe, it, expect, beforeEach } from 'vitest';
import { renderPage } from './renderer';
import { resetDefIdCounter } from './svg-utils';
import type { Layer } from '../schema/types';

// Regression for the multi-page preview bug: the per-layer render cache cloned a
// layer's element but NOT its <defs> entry, so a cached gradient/pattern/filter
// layer replayed into a fresh SVG (every page-strip thumbnail + a re-rendered
// canvas) referenced a url(#id) def that did not exist there → the fill silently
// dropped out (thumbnails blinked white on page switch).

const gradRect = (id: string): Layer => ({
  id, type: 'rect', x: 0, y: 0, width: 100, height: 100,
  fill: { type: 'radial', stops: [{ color: '#F28C28', position: 0 }, { color: '#0E1621', position: 100 }] },
} as unknown as Layer);

describe('render cache keeps every SVG self-contained (no dangling def refs)', () => {
  beforeEach(() => resetDefIdCounter());

  it('a gradient fill resolves to a LOCAL def on every render of the same layer', () => {
    const layers = [gradRect('mesh')];
    const a = renderPage(layers, 200, 200);
    const b = renderPage(layers, 200, 200);   // second render would hit the layer cache
    for (const svg of [a, b]) {
      const fill = svg.querySelector('rect')?.getAttribute('fill') ?? '';
      const id = /url\(#(.+?)\)/.exec(fill)?.[1];
      expect(id, 'rect should reference a gradient def').toBeTruthy();
      expect(svg.querySelector(`#${id}`), 'the referenced gradient must exist in THIS svg').toBeTruthy();
    }
  });

  it('two coexisting SVGs never share a def id (no cross-svg collision)', () => {
    const a = renderPage([gradRect('m1')], 200, 200);
    const b = renderPage([gradRect('m2')], 200, 200);
    const idOf = (svg: SVGSVGElement): string => /url\(#(.+?)\)/.exec(svg.querySelector('rect')?.getAttribute('fill') ?? '')?.[1] ?? '';
    expect(idOf(a)).not.toBe(idOf(b));   // monotonic counter, no per-render reset
  });
});
