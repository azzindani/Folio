import { describe, it, expect } from 'vitest';
import { renderPage } from './renderer';
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

  // This asserted that two coexisting SVGs NEVER share a def id, and its comment
  // named the mechanism it depended on: "monotonic counter, no per-render
  // reset". That counter was the reason the same design exported to different
  // bytes on every call. Ids are now content-derived, so two SVGs CAN share one
  // — and the guarantee that matters is sharper than non-collision:
  //
  //   a shared id always means an identical definition.
  //
  // That is what makes it safe for presentation-assembler and html-assembler,
  // which join many pages into ONE document where url(#x) resolves to the first
  // match. Resolving to either copy paints the same thing.
  const idOf = (svg: SVGSVGElement): string =>
    /url\(#(.+?)\)/.exec(svg.querySelector('rect')?.getAttribute('fill') ?? '')?.[1] ?? '';
  const defOf = (svg: SVGSVGElement, id: string): string =>
    svg.querySelector(`#${id}`)?.innerHTML ?? '';

  it('two SVGs sharing a def id have byte-identical definitions', () => {
    const a = renderPage([gradRect('m1')], 200, 200);
    const b = renderPage([gradRect('m2')], 200, 200);
    expect(idOf(a)).toBe(idOf(b));
    expect(defOf(a, idOf(a))).toBe(defOf(b, idOf(b)));
    expect(defOf(a, idOf(a)), 'the def should have real content').not.toBe('');
  });

  it('two SVGs with DIFFERENT fills never share an id', () => {
    // The only collision that could paint the wrong thing.
    const a = renderPage([gradRect('m1')], 200, 200);
    const other = { ...gradRect('m2') } as unknown as Record<string, unknown>;
    other['fill'] = { type: 'radial', stops: [{ color: '#123456', position: 0 }, { color: '#654321', position: 100 }] };
    const b = renderPage([other as unknown as Layer], 200, 200);
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it('the same design renders to the same ids every time', () => {
    // The whole point: three exports of one unchanged design were three
    // different files (lg-1/noise-2/noise-3, then lg-4/noise-5/noise-6).
    const layers = [gradRect('m1')];
    expect(idOf(renderPage(layers, 200, 200))).toBe(idOf(renderPage(layers, 200, 200)));
  });
});
