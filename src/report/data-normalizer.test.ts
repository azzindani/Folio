import { describe, it, expect } from 'vitest';
import { normalizeDataset, normalizeAll } from './data-normalizer';
import type { LoadedDataset } from './data-loader';

describe('normalizeDataset', () => {
  it('returns empty dataset unchanged', () => {
    const ds: LoadedDataset = { id: 'x', rows: [] };
    expect(normalizeDataset(ds).rows).toEqual([]);
  });

  it('coerces string numbers to number type', () => {
    const ds: LoadedDataset = { id: 'x', rows: [{ v: '42' }, { v: '7' }] };
    const result = normalizeDataset(ds);
    expect(typeof result.rows[0]['v']).toBe('number');
    expect(result.rows[0]['v']).toBe(42);
  });

  it('preserves numeric columns already typed correctly', () => {
    const ds: LoadedDataset = { id: 'x', rows: [{ v: 42 }, { v: 7 }] };
    const result = normalizeDataset(ds);
    expect(result.rows[0]['v']).toBe(42);
  });

  it('trims string whitespace', () => {
    const ds: LoadedDataset = { id: 'x', rows: [{ name: '  Alice  ' }] };
    const result = normalizeDataset(ds);
    expect(result.rows[0]['name']).toBe('Alice');
  });

  it('preserves null and undefined values', () => {
    const ds: LoadedDataset = { id: 'x', rows: [{ a: null, b: undefined }] };
    const result = normalizeDataset(ds);
    expect(result.rows[0]['a']).toBeNull();
    expect(result.rows[0]['b']).toBeUndefined();
  });

  it('does not coerce mixed columns (string + number)', () => {
    const ds: LoadedDataset = { id: 'x', rows: [{ v: 'foo' }, { v: '42' }] };
    const result = normalizeDataset(ds);
    expect(typeof result.rows[1]['v']).toBe('string');
  });

  it('preserves dataset id', () => {
    const ds: LoadedDataset = { id: 'my-source', rows: [{ x: 1 }] };
    expect(normalizeDataset(ds).id).toBe('my-source');
  });
});

describe('normalizeAll', () => {
  it('normalizes every dataset in the map', () => {
    const map = new Map<string, LoadedDataset>([
      ['a', { id: 'a', rows: [{ v: '10' }] }],
      ['b', { id: 'b', rows: [{ name: '  Bob  ' }] }],
    ]);
    const result = normalizeAll(map);
    expect(result.get('a')?.rows[0]['v']).toBe(10);
    expect(result.get('b')?.rows[0]['name']).toBe('Bob');
  });
});
