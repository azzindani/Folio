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

describe('Gradient text color', () => {
  it('plain text with string color renders fill attribute', () => {
    const spec = makeSpec([
      { id: 'tx', type: 'text', z: 1, x: 0, y: 0, width: 200, height: 50,
        content: { type: 'plain', value: 'Hello' },
        style: { color: '#ff0000' },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const text = svg.querySelector('text');
    expect(text?.getAttribute('fill')).toBe('#ff0000');
  });

  it('plain text with linear gradient color creates defs and url fill', () => {
    const spec = makeSpec([
      { id: 'tx', type: 'text', z: 1, x: 0, y: 0, width: 200, height: 50,
        content: { type: 'plain', value: 'Gradient' },
        style: {
          color: {
            type: 'linear',
            angle: 90,
            stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }],
          },
        },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const text = svg.querySelector('text');
    const fill = text?.getAttribute('fill') ?? '';
    expect(fill).toMatch(/^url\(#lg-/);
    expect(svg.querySelector('linearGradient')).not.toBeNull();
  });

  it('plain text with radial gradient color creates defs and url fill', () => {
    const spec = makeSpec([
      { id: 'tx2', type: 'text', z: 1, x: 0, y: 0, width: 200, height: 50,
        content: { type: 'plain', value: 'Radial' },
        style: {
          color: {
            type: 'radial',
            cx: 50, cy: 50, radius: 50,
            stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 100 }],
          },
        },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const text = svg.querySelector('text');
    const fill = text?.getAttribute('fill') ?? '';
    expect(fill).toMatch(/^url\(#rg-/);
    expect(svg.querySelector('radialGradient')).not.toBeNull();
  });
});

describe('Gradient stroke color', () => {
  it('rect with string stroke color renders stroke attribute', () => {
    const spec = makeSpec([
      { id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100,
        stroke: { color: '#00ff00', width: 2 },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const rect = svg.querySelector('rect');
    expect(rect?.getAttribute('stroke')).toBe('#00ff00');
  });

  it('rect with linear gradient stroke creates gradient def and url stroke', () => {
    const spec = makeSpec([
      { id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 100,
        fill: { type: 'none' },
        stroke: {
          color: {
            type: 'linear',
            angle: 45,
            stops: [{ color: '#f00', position: 0 }, { color: '#00f', position: 100 }],
          },
          width: 3,
        },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const rect = svg.querySelector('rect');
    const stroke = rect?.getAttribute('stroke') ?? '';
    expect(stroke).toMatch(/^url\(#lg-/);
    expect(svg.querySelector('linearGradient')).not.toBeNull();
  });

  it('circle with radial gradient stroke', () => {
    const spec = makeSpec([
      { id: 'c', type: 'circle', z: 1, x: 0, y: 0, width: 100, height: 100,
        stroke: {
          color: { type: 'radial', cx: 50, cy: 50, radius: 50,
            stops: [{ color: '#f00', position: 0 }, { color: '#00f', position: 100 }] },
          width: 2,
        },
      } as unknown as Layer,
    ]);
    const svg = renderDesign(spec);
    const el = svg.querySelector('ellipse');
    expect(el?.getAttribute('stroke')).toMatch(/^url\(#rg-/);
  });
});
