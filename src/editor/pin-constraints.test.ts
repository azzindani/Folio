import { describe, it, expect } from 'vitest';
import { applyPinConstraints, pinLayer } from './pin-constraints';
import type { Layer } from '../schema/types';

const L = (over: Partial<Layer> & { constraints?: unknown }): Layer =>
  ({ id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, ...over } as unknown as Layer);

const doc = (w: number, h: number) => ({ width: w, height: h });

describe('pinLayer', () => {
  it('right-pinned layer keeps its far-edge offset when the doc widens', () => {
    // right gap = 1000 - 800 - 100 = 100
    const l = L({ x: 800, width: 100, constraints: { right: true } });
    const r = pinLayer(l, doc(1000, 600), doc(1200, 600)) as unknown as { x: number; width: number };
    expect(r.x).toBe(1000);       // 1200 - 100 gap - 100 width
    expect(r.width).toBe(100);    // size unchanged
  });

  it('left-pinned layer stays put', () => {
    const l = L({ x: 40, constraints: { left: true } });
    const r = pinLayer(l, doc(1000, 600), doc(1400, 600)) as unknown as { x: number };
    expect(r.x).toBe(40);
  });

  it('left+right pinned (no fix) stretches to hold both offsets', () => {
    const l = L({ x: 50, width: 900, constraints: { left: true, right: true } }); // right gap 50
    const r = pinLayer(l, doc(1000, 600), doc(1300, 600)) as unknown as { x: number; width: number };
    expect(r.x).toBe(50);
    expect(r.width).toBe(1200);   // 1300 - 50 - 50
  });

  it('left+right pinned + fix_width holds left, keeps size', () => {
    const l = L({ x: 50, width: 900, constraints: { left: true, right: true, fix_width: true } });
    const r = pinLayer(l, doc(1000, 600), doc(1300, 600)) as unknown as { x: number; width: number };
    expect(r.x).toBe(50);
    expect(r.width).toBe(900);
  });

  it('bottom-pinned keeps its bottom offset on a taller doc', () => {
    const l = L({ y: 500, height: 80, constraints: { bottom: true } }); // bottom gap 20
    const r = pinLayer(l, doc(600, 600), doc(600, 900)) as unknown as { y: number };
    expect(r.y).toBe(800);        // 900 - 20 - 80
  });

  it('unpinned axis floats proportionally by center', () => {
    const l = L({ x: 400, width: 100, constraints: { top: true } }); // center 450, ratio 2
    const r = pinLayer(l, doc(1000, 600), doc(2000, 600)) as unknown as { x: number };
    expect(r.x).toBe(850);        // center 900 - 50
  });

  it('no constraints → unchanged reference', () => {
    const l = L({ x: 10 });
    expect(pinLayer(l, doc(1000, 600), doc(1200, 600))).toBe(l);
  });
});

describe('applyPinConstraints', () => {
  it('same size → returns the same array reference', () => {
    const layers = [L({ constraints: { right: true } })];
    expect(applyPinConstraints(layers, doc(1000, 600), doc(1000, 600))).toBe(layers);
  });

  it('recurses into group children pinned against the document', () => {
    const child = L({ id: 'c', x: 800, width: 100, constraints: { right: true } });
    const group = { id: 'g', type: 'group', z: 0, layers: [child] } as unknown as Layer;
    const out = applyPinConstraints([group], doc(1000, 600), doc(1200, 600)) as unknown as
      Array<{ layers: Array<{ x: number }> }>;
    expect(out[0].layers[0].x).toBe(1000);
  });
});
