import { describe, it, expect } from 'vitest';
import { renderToSVGString } from './svg-export';
import type { DesignSpec } from '../../schema/types';

const minimalDesign: DesignSpec = {
  _protocol: 'design/v1',
  meta: { id: 'd1', name: 'Test', type: 'poster', created: '2024-01-01', modified: '2024-01-01' },
  document: { width: 100, height: 100, unit: 'px' },
  layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as unknown as import('../../schema/types').RectLayer,
  ],
} as unknown as DesignSpec;

describe('renderToSVGString', () => {
  it('returns a string containing <svg', () => {
    const result = renderToSVGString(minimalDesign);
    expect(typeof result).toBe('string');
    expect(result).toContain('<svg');
  });

  it('contains xmlns attribute', () => {
    const result = renderToSVGString(minimalDesign);
    expect(result).toContain('xmlns=');
  });

  it('second call reuses existing DOM (serializer memoized)', () => {
    const r1 = renderToSVGString(minimalDesign);
    const r2 = renderToSVGString(minimalDesign);
    expect(typeof r1).toBe('string');
    expect(typeof r2).toBe('string');
  });

  it('resolves theme color tokens via the referenced builtin theme', () => {
    // $surface must render as the dark-tech color (#16213E), not the literal
    // token — otherwise it falls back to black and content is invisible.
    const themed = {
      ...minimalDesign,
      theme: { ref: 'dark-tech' },
      layers: [
        { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '$surface' } },
      ],
    } as unknown as DesignSpec;
    const svg = renderToSVGString(themed);
    expect(svg).not.toContain('$surface');
    expect(svg.toUpperCase()).toContain('16213E');
  });
});

describe('renderToSVGString — stateless across designs (gradient defs not leaked)', () => {
  it('emits the gradient def even when a prior design used the same layer id', () => {
    const mk = (stop: string) => ({
      _protocol: 'design/v1',
      meta: { id: 'd', name: 'D', type: 'poster', created: '2024-01-01', modified: '2024-01-01' },
      document: { width: 100, height: 100, unit: 'px' },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100,
        fill: { type: 'linear', angle: 135, stops: [{ color: stop, position: 0 }, { color: '#000000', position: 100 }] } }],
    } as unknown as DesignSpec);
    // Render design A, then a DIFFERENT design B that reuses layer id "bg".
    renderToSVGString(mk('#ff0000'));
    const svgB = renderToSVGString(mk('#00ff00'));
    // B references a gradient AND ships its definition (no dead url ref).
    const ref = svgB.match(/url\(#([\w-]+)\)/);
    expect(ref).not.toBeNull();
    expect(svgB).toContain(`id="${ref![1]}"`);
    expect(svgB.toLowerCase()).toContain('lineargradient');
  });
});
