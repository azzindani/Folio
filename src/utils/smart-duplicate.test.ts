import { describe, it, expect } from 'vitest';
import { smartDuplicate } from './smart-duplicate';
import type { Layer } from '../schema/types';

function rectLayer(id: string, x = 0, y = 0, w = 100, h = 100): Layer {
  return { id, type: 'rect', x, y, z: 1, width: w, height: h } as unknown as Layer;
}

describe('smartDuplicate — offset mode', () => {
  it('clones each layer with default offset (20, 20)', () => {
    const layers = [rectLayer('l1', 10, 20)];
    const result = smartDuplicate(layers, { mode: 'offset' });
    expect(result).toHaveLength(1);
    expect((result[0] as unknown as Record<string, unknown>)['x']).toBe(30);
    expect((result[0] as unknown as Record<string, unknown>)['y']).toBe(40);
  });

  it('uses custom offsetX and offsetY', () => {
    const layers = [rectLayer('l1', 0, 0)];
    const result = smartDuplicate(layers, { mode: 'offset', offsetX: 50, offsetY: 10 });
    expect((result[0] as unknown as Record<string, unknown>)['x']).toBe(50);
    expect((result[0] as unknown as Record<string, unknown>)['y']).toBe(10);
  });

  it('assigns new unique ids', () => {
    const layers = [rectLayer('original')];
    const result = smartDuplicate(layers, { mode: 'offset' });
    expect(result[0].id).not.toBe('original');
  });

  it('increments z by 1', () => {
    const layers = [rectLayer('l1')];
    const result = smartDuplicate(layers, { mode: 'offset' });
    expect((result[0] as unknown as Record<string, unknown>)['z']).toBe(2);
  });

  it('handles multiple layers', () => {
    const layers = [rectLayer('a'), rectLayer('b'), rectLayer('c')];
    const result = smartDuplicate(layers, { mode: 'offset' });
    expect(result).toHaveLength(3);
    result.forEach(r => {
      expect(['a', 'b', 'c']).not.toContain(r.id);
    });
  });

  it('returns empty array for empty input', () => {
    expect(smartDuplicate([], { mode: 'offset' })).toEqual([]);
  });
});

describe('smartDuplicate — grid mode', () => {
  it('produces (cols × rows - 1) copies per layer', () => {
    const layers = [rectLayer('l1')];
    const result = smartDuplicate(layers, { mode: 'grid', cols: 3, rows: 3 });
    // 3×3 = 9 cells, skip original (0,0) → 8 copies
    expect(result).toHaveLength(8);
  });

  it('uses default cols=3 rows=3', () => {
    const layers = [rectLayer('l1')];
    const result = smartDuplicate(layers, { mode: 'grid' });
    expect(result).toHaveLength(8);
  });

  it('spaces clones by layer width + colGap', () => {
    const layers = [rectLayer('l1', 0, 0, 50, 40)];
    const result = smartDuplicate(layers, { mode: 'grid', cols: 2, rows: 1, colGap: 10, rowGap: 0 });
    // (r=0, c=1): dx = 1 * (50 + 10) = 60
    const clone = result[0] as unknown as Record<string, unknown>;
    expect(clone['x']).toBe(60);
    expect(clone['y']).toBe(0);
  });

  it('default colGap=10 rowGap=10', () => {
    const layers = [rectLayer('l1', 0, 0, 100, 100)];
    // cols=2, rows=2 → only positions (0,1), (1,0), (1,1)
    const result = smartDuplicate(layers, { mode: 'grid', cols: 2, rows: 2 });
    expect(result).toHaveLength(3);
  });

  it('clamps cols and rows to at least 1', () => {
    const layers = [rectLayer('l1')];
    const result = smartDuplicate(layers, { mode: 'grid', cols: 0, rows: 0 });
    // 1×1 grid with (0,0) skipped = 0 copies
    expect(result).toHaveLength(0);
  });

  it('handles layer with non-numeric dimensions (defaults to 100)', () => {
    const layer = { id: 'l1', type: 'rect', x: 0, y: 0, z: 0 } as unknown as Layer;
    const result = smartDuplicate([layer], { mode: 'grid', cols: 2, rows: 1 });
    // width defaults to 100, colGap=10 → dx = 110
    const clone = result[0] as unknown as Record<string, unknown>;
    expect(clone['x']).toBe(110);
  });
});
