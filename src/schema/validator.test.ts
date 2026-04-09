import { describe, it, expect } from 'vitest';
import {
  validateLayer,
  validateFill,
  validateDesignLayers,
  validateDesignSpec,
  expandPositionShorthand,
} from './validator';
import type { DesignSpec, Layer, BaseLayer } from './types';

describe('validateLayer', () => {
  it('returns error when id is missing', () => {
    const errors = validateLayer({ type: 'rect', z: 0 } as Partial<BaseLayer>, 'layers[0]');
    expect(errors.some(e => e.path === 'layers[0].id')).toBe(true);
  });

  it('returns error when type is missing', () => {
    const errors = validateLayer({ id: 'test', z: 0 } as Partial<BaseLayer>, 'layers[0]');
    expect(errors.some(e => e.path === 'layers[0].type')).toBe(true);
  });

  it('returns error for unknown layer type', () => {
    const errors = validateLayer({ id: 'test', type: 'unknown' as 'rect', z: 0 }, 'layers[0]');
    expect(errors.some(e => e.message.includes('Unknown layer type'))).toBe(true);
  });

  it('returns error when z is missing', () => {
    const errors = validateLayer({ id: 'test', type: 'rect' } as Partial<BaseLayer>, 'layers[0]');
    expect(errors.some(e => e.path === 'layers[0].z')).toBe(true);
  });

  it('returns no errors for valid layer', () => {
    const errors = validateLayer({ id: 'bg', type: 'rect', z: 0 }, 'layers[0]');
    expect(errors).toHaveLength(0);
  });

  it('accepts all valid layer types', () => {
    const types = [
      'rect', 'circle', 'path', 'polygon', 'line', 'text', 'image', 'icon',
      'component', 'component_list', 'mermaid', 'chart', 'code', 'math', 'group',
    ];
    for (const type of types) {
      const errors = validateLayer({ id: 'test', type: type as BaseLayer['type'], z: 0 }, 'l');
      expect(errors).toHaveLength(0);
    }
  });
});

describe('validateFill', () => {
  it('returns error when fill type is missing', () => {
    const errors = validateFill({} as { type: undefined }, 'fill');
    expect(errors.some(e => e.path === 'fill.type')).toBe(true);
  });

  it('returns error for unknown fill type', () => {
    const errors = validateFill({ type: 'unknown' as 'solid' }, 'fill');
    expect(errors.some(e => e.message.includes('Unknown fill type'))).toBe(true);
  });

  it('returns error when solid fill has no color', () => {
    const errors = validateFill({ type: 'solid' } as { type: 'solid' }, 'fill');
    expect(errors.some(e => e.path === 'fill.color')).toBe(true);
  });

  it('validates solid fill successfully', () => {
    const errors = validateFill({ type: 'solid', color: '#FF0000' }, 'fill');
    expect(errors).toHaveLength(0);
  });

  it('returns error when gradient has less than 2 stops', () => {
    const errors = validateFill({
      type: 'linear',
      angle: 0,
      stops: [{ color: '#000', position: 0 }],
    }, 'fill');
    expect(errors.some(e => e.path === 'fill.stops')).toBe(true);
  });

  it('validates linear gradient with 2+ stops', () => {
    const errors = validateFill({
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#000', position: 0 },
        { color: '#FFF', position: 100 },
      ],
    }, 'fill');
    expect(errors).toHaveLength(0);
  });

  it('validates none fill', () => {
    const errors = validateFill({ type: 'none' }, 'fill');
    expect(errors).toHaveLength(0);
  });
});

describe('validateDesignLayers', () => {
  it('detects duplicate layer IDs', () => {
    const layers: Layer[] = [
      { id: 'dup', type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10 },
      { id: 'dup', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10 },
    ];
    const errors = validateDesignLayers(layers, 'layers');
    expect(errors.some(e => e.message.includes('Duplicate layer id'))).toBe(true);
  });

  it('detects duplicate z-index values', () => {
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 5, x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'rect', z: 5, x: 0, y: 0, width: 10, height: 10 },
    ];
    const errors = validateDesignLayers(layers, 'layers');
    expect(errors.some(e => e.message.includes('Duplicate z-index'))).toBe(true);
  });

  it('validates group children recursively', () => {
    const layers: Layer[] = [
      {
        id: 'grp',
        type: 'group',
        z: 10,
        layers: [
          { id: 'child', type: 'rect', z: 0 } as Layer,
          { id: 'child', type: 'rect', z: 1 } as Layer, // duplicate id
        ],
      },
    ];
    const errors = validateDesignLayers(layers, 'layers');
    expect(errors.some(e => e.message.includes('Duplicate layer id'))).toBe(true);
  });

  it('returns no errors for valid layers', () => {
    const layers: Layer[] = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', type: 'text', z: 20, x: 10, y: 10, width: 80, height: 'auto', content: { type: 'plain', value: 'hi' } },
    ];
    const errors = validateDesignLayers(layers, 'layers');
    const criticalErrors = errors.filter(e => e.severity === 'error');
    expect(criticalErrors).toHaveLength(0);
  });
});

describe('validateDesignSpec', () => {
  const validSpec: DesignSpec = {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [],
  };

  it('validates a correct spec with no errors', () => {
    const errors = validateDesignSpec(validSpec);
    expect(errors.filter(e => e.severity === 'error')).toHaveLength(0);
  });

  it('returns error for wrong protocol', () => {
    const errors = validateDesignSpec({ ...validSpec, _protocol: 'design/v2' as 'design/v1' });
    expect(errors.some(e => e.path === '_protocol')).toBe(true);
  });

  it('returns error when meta is missing', () => {
    const errors = validateDesignSpec({ ...validSpec, meta: undefined as unknown as DesignSpec['meta'] });
    expect(errors.some(e => e.path === 'meta')).toBe(true);
  });

  it('returns error when document is missing', () => {
    const errors = validateDesignSpec({ ...validSpec, document: undefined as unknown as DesignSpec['document'] });
    expect(errors.some(e => e.path === 'document')).toBe(true);
  });

  it('returns error for zero document width', () => {
    const errors = validateDesignSpec({ ...validSpec, document: { ...validSpec.document, width: 0 } });
    expect(errors.some(e => e.path === 'document.width')).toBe(true);
  });

  it('validates pages', () => {
    const spec: DesignSpec = {
      ...validSpec,
      pages: [
        { id: 'p1', layers: [{ id: 'a', type: 'rect', z: 0 } as Layer] },
        { id: '', layers: [] }, // missing id
      ],
    };
    const errors = validateDesignSpec(spec);
    expect(errors.some(e => e.path.includes('pages[1].id'))).toBe(true);
  });
});

describe('expandPositionShorthand', () => {
  it('expands array shorthand [x, y, w, h]', () => {
    const layer: BaseLayer = { id: 'test', type: 'rect', z: 0, pos: [10, 20, 100, 200] };
    const result = expandPositionShorthand(layer);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
  });

  it('returns layer unchanged if no pos shorthand', () => {
    const layer: BaseLayer = { id: 'test', type: 'rect', z: 0, x: 5, y: 10 };
    const result = expandPositionShorthand(layer);
    expect(result.x).toBe(5);
    expect(result.y).toBe(10);
  });
});
