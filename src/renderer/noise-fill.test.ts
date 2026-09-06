import { describe, it, expect } from 'vitest';
import { renderRect, renderCircle, renderPath, renderPolygon } from './layer-renderers-shapes';
import type { RectLayer, CircleLayer, PathLayer, PolygonLayer } from '../schema/types';

// A `noise` fill paints nothing on the shape itself — applyFill returns
// fill:'none' plus a SIBLING rect carrying the turbulence filter, which the
// caller must place. Only the layout renderer ever did. Found by exporting a
// poster to SVG and noticing a <filter id="noise-11"> that nothing referenced,
// beside a rect with fill="none": the engine's own background composer emits
// `{id:"…_grain", type:"rect", fill:{type:"noise"}}` for a grain sweep, so 22
// of 276 library designs carried a grain nobody had ever seen.

const svg = (): SVGSVGElement => document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
const NOISE = { type: 'noise', frequency: 0.9, octaves: 2, opacity: 0.06 };

const noisy = <T>(extra: Record<string, unknown>): T =>
  ({ id: 'g1', z: 0, x: 80, y: 780, width: 920, height: 480, fill: NOISE, ...extra } as unknown as T);

describe('a noise fill actually paints', () => {
  it('rect emits the filtered rect, not just fill="none"', () => {
    const out = renderRect(noisy<RectLayer>({ type: 'rect' }), svg());
    const filtered = out.querySelectorAll('[filter]');
    expect(filtered.length, 'no element carries the noise filter').toBe(1);
    expect(filtered[0]?.getAttribute('filter')).toMatch(/^url\(#noise-/);
  });

  it('places the noise on the layer box, not at the canvas origin', () => {
    const out = renderRect(noisy<RectLayer>({ type: 'rect' }), svg());
    const n = out.querySelector('[filter]');
    expect(n?.getAttribute('x')).toBe('80');
    expect(n?.getAttribute('y')).toBe('780');
    expect(n?.getAttribute('width')).toBe('920');
    expect(n?.getAttribute('height')).toBe('480');
  });

  it('carries the fill opacity onto the grain', () => {
    const out = renderRect(noisy<RectLayer>({ type: 'rect' }), svg());
    expect(out.querySelector('[filter]')?.getAttribute('opacity')).toBe('0.06');
  });

  it('paints the grain ABOVE the shape it belongs to', () => {
    const out = renderRect(noisy<RectLayer>({ type: 'rect' }), svg());
    const kids = Array.from(out.children);
    expect(kids.length).toBe(2);
    expect(kids[1]?.getAttribute('filter')).toMatch(/^url\(#noise-/);
  });

  it('ellipse, path and polygon carry it too', () => {
    const cases: SVGElement[] = [
      renderCircle(noisy<CircleLayer>({ type: 'ellipse' }), svg()),
      renderPath(noisy<PathLayer>({ type: 'path', d: 'M0,0 L10,10' }), svg()),
      renderPolygon(noisy<PolygonLayer>({ type: 'polygon', sides: 5 }), svg()),
    ];
    for (const out of cases) expect(out.querySelectorAll('[filter]').length).toBe(1);
  });

  it('leaves every other fill untouched — no wrapper, no extra nodes', () => {
    // The wrap happens ONLY when there is something to add, so a plain shape's
    // output is exactly what it was before.
    const plain = renderRect({ id: 'r', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10,
      fill: '#fff' } as unknown as RectLayer, svg());
    expect(plain.tagName.toLowerCase()).toBe('rect');
    expect(plain.getAttribute('fill')).toBe('#fff');
    expect(plain.querySelectorAll('[filter]').length).toBe(0);
  });

  it('a multi fill containing noise still paints its grain', () => {
    const out = renderRect({ id: 'm', type: 'rect', z: 0, x: 5, y: 6, width: 20, height: 30,
      fill: { type: 'multi', layers: [{ type: 'solid', color: '#101820' }, NOISE] },
    } as unknown as RectLayer, svg());
    expect(out.querySelectorAll('[filter]').length).toBe(1);
    expect(out.querySelector('rect')?.getAttribute('fill')).toBe('#101820');
  });
});
