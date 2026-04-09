import { describe, it, expect } from 'vitest';
import { expandShorthand, expandLayerShorthands } from './shorthand-expander';
import type { Layer } from '../schema/types';

describe('expandShorthand', () => {
  it('expands pos array [x,y,w,h] to explicit fields', () => {
    const raw = { id: 'a', type: 'rect', z: 10, pos: [100, 200, 300, 400] };
    const result = expandShorthand(raw as unknown as Record<string, unknown>);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.width).toBe(300);
    expect(result.height).toBe(400);
    expect((result as unknown as Record<string, unknown>)['pos']).toBeUndefined();
  });

  it('removes the pos key after expansion', () => {
    const result = expandShorthand({ id: 'a', type: 'rect', z: 10, pos: [0, 0, 100, 100] } as unknown as Record<string, unknown>);
    expect(Object.prototype.hasOwnProperty.call(result, 'pos')).toBe(false);
  });

  it('leaves explicit x,y,width,height unchanged', () => {
    const raw: Layer = { id: 'b', type: 'rect', z: 10, x: 50, y: 60, width: 200, height: 150 } as Layer;
    const result = expandShorthand(raw as unknown as Record<string, unknown>);
    expect(result.x).toBe(50);
    expect(result.y).toBe(60);
    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
  });

  it('does not expand pos if fewer than 4 elements', () => {
    const raw = { id: 'c', type: 'rect', z: 10, pos: [1, 2, 3] };
    const result = expandShorthand(raw as unknown as Record<string, unknown>);
    expect((result as unknown as Record<string, unknown>)['pos']).toEqual([1, 2, 3]);
    expect(result.x).toBeUndefined();
  });

  it('does not expand pos if more than 4 elements', () => {
    const raw = { id: 'd', type: 'rect', z: 10, pos: [1, 2, 3, 4, 5] };
    const result = expandShorthand(raw as unknown as Record<string, unknown>);
    expect((result as unknown as Record<string, unknown>)['pos']).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not expand pos if not an array', () => {
    const raw = { id: 'e', type: 'rect', z: 10, pos: '100 200 300 400' };
    const result = expandShorthand(raw as unknown as Record<string, unknown>);
    expect((result as unknown as Record<string, unknown>)['pos']).toBe('100 200 300 400');
  });

  it('does not mutate the original object', () => {
    const raw = { id: 'f', type: 'rect', z: 10, pos: [10, 20, 30, 40] };
    expandShorthand(raw as unknown as Record<string, unknown>);
    expect((raw as unknown as Record<string, unknown>)['pos']).toEqual([10, 20, 30, 40]);
  });
});

describe('expandLayerShorthands', () => {
  it('expands all layers with pos shorthand', () => {
    const layers = [
      { id: 'a', type: 'rect', z: 10, pos: [0, 0, 100, 100] },
      { id: 'b', type: 'circle', z: 20, x: 50, y: 50, width: 80, height: 80 },
    ] as unknown as Layer[];

    const result = expandLayerShorthands(layers);

    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(100);
    expect(result[0].height).toBe(100);
    expect(result[1].x).toBe(50);
    expect(result[1].y).toBe(50);
  });

  it('returns a new array (does not mutate input)', () => {
    const layers = [{ id: 'a', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100 }] as Layer[];
    const result = expandLayerShorthands(layers);
    expect(result).not.toBe(layers);
  });

  it('handles empty array', () => {
    expect(expandLayerShorthands([])).toEqual([]);
  });
});
