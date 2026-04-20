import { describe, it, expect } from 'vitest';
import { renderDesign } from './renderer';
import type { DesignSpec, Layer } from '../schema/types';

function makeSpec(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 400, height: 400, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

describe('Boolean ops — clip_path_ref', () => {
  it('renders normally when no clip_path_ref', () => {
    const spec = makeSpec([
      { id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100 } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    expect(svg.querySelector('[data-layer-id="r"]')).not.toBeNull();
    // No clipPath defs when none referenced
    expect(svg.querySelector('clipPath')).toBeNull();
  });

  it('creates <clipPath> in <defs> for referenced mask layer (rect)', () => {
    const spec = makeSpec([
      { id: 'mask', type: 'rect', z: 2, x: 50, y: 50, width: 100, height: 100 } as unknown as Layer,
      { id: 'target', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200, clip_path_ref: 'mask' } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const defs = svg.querySelector('defs');
    expect(defs).not.toBeNull();
    const cp = defs!.querySelector('#cp-mask');
    expect(cp).not.toBeNull();
    expect(cp!.tagName.toLowerCase()).toBe('clippath');
  });

  it('applies clip-path attribute to target layer element', () => {
    const spec = makeSpec([
      { id: 'clip-shape', type: 'circle', z: 2, x: 0, y: 0, width: 80, height: 80 } as unknown as Layer,
      { id: 'img', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200, clip_path_ref: 'clip-shape' } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const el = svg.querySelector('[data-layer-id="img"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('clip-path')).toBe('url(#cp-clip-shape)');
  });

  it('circle mask generates <ellipse> in clipPath', () => {
    const spec = makeSpec([
      { id: 'c', type: 'circle', z: 2, x: 10, y: 10, width: 100, height: 100 } as unknown as Layer,
      { id: 't', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200, clip_path_ref: 'c' } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const cp = svg.querySelector('#cp-c');
    expect(cp!.querySelector('ellipse')).not.toBeNull();
  });

  it('polygon mask generates <polygon> in clipPath', () => {
    const spec = makeSpec([
      { id: 'hex', type: 'polygon', z: 2, x: 50, y: 50, width: 100, height: 100, sides: 6 } as unknown as Layer,
      { id: 'img', type: 'rect', z: 1, x: 0, y: 0, width: 200, height: 200, clip_path_ref: 'hex' } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const cp = svg.querySelector('#cp-hex');
    expect(cp!.querySelector('polygon')).not.toBeNull();
  });

  it('layers without clip_path_ref have no clip-path attribute', () => {
    const spec = makeSpec([
      { id: 'plain', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100 } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const el = svg.querySelector('[data-layer-id="plain"]');
    expect(el!.getAttribute('clip-path')).toBeNull();
  });
});
