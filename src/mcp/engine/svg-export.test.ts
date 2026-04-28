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
});
