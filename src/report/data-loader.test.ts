import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadDataSource, loadAllSources } from './data-loader';
import type { DataSource } from '../schema/types';

const TMP = '/tmp/folio-report-test';

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('loadDataSource — inline', () => {
  it('returns rows as-is', async () => {
    const src: DataSource = { id: 'x', type: 'inline', rows: [{ a: 1 }, { a: 2 }] };
    const result = await loadDataSource(src);
    expect(result.id).toBe('x');
    expect(result.rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('returns empty rows when rows undefined', async () => {
    const src: DataSource = { id: 'x', type: 'inline' };
    const result = await loadDataSource(src);
    expect(result.rows).toEqual([]);
  });
});

describe('loadDataSource — json', () => {
  it('loads array JSON', async () => {
    const path = join(TMP, 'data.json');
    writeFileSync(path, JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]));
    const src: DataSource = { id: 'users', type: 'json', path };
    const result = await loadDataSource(src);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ id: 1, name: 'Alice' });
  });

  it('wraps object JSON in array', async () => {
    const path = join(TMP, 'obj.json');
    writeFileSync(path, JSON.stringify({ key: 'value' }));
    const src: DataSource = { id: 'obj', type: 'json', path };
    const result = await loadDataSource(src);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ key: 'value' });
  });

  it('resolves path relative to baseDir', async () => {
    writeFileSync(join(TMP, 'rel.json'), JSON.stringify([{ v: 99 }]));
    const src: DataSource = { id: 'rel', type: 'json', path: 'rel.json' };
    const result = await loadDataSource(src, TMP);
    expect(result.rows[0]).toMatchObject({ v: 99 });
  });
});

describe('loadDataSource — csv', () => {
  it('parses csv with headers', async () => {
    const path = join(TMP, 'sales.csv');
    writeFileSync(path, 'month,revenue\nJan,100\nFeb,200\n');
    const src: DataSource = { id: 'sales', type: 'csv', path, headers: true };
    const result = await loadDataSource(src);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ month: 'Jan', revenue: 100 });
  });

  it('coerces numeric values', async () => {
    const path = join(TMP, 'nums.csv');
    writeFileSync(path, 'a,b\n1,2\n3,4\n');
    const src: DataSource = { id: 'n', type: 'csv', path };
    const result = await loadDataSource(src);
    expect(typeof result.rows[0]['a']).toBe('number');
  });

  it('handles quoted fields with commas', async () => {
    const path = join(TMP, 'quoted.csv');
    writeFileSync(path, 'name,desc\n"Smith, Jr.",engineer\n');
    const src: DataSource = { id: 'q', type: 'csv', path };
    const result = await loadDataSource(src);
    expect(result.rows[0]['name']).toBe('Smith, Jr.');
  });

  it('generates col0/col1 headers when headers:false', async () => {
    const path = join(TMP, 'noheader.csv');
    writeFileSync(path, '10,20\n30,40\n');
    const src: DataSource = { id: 'nh', type: 'csv', path, headers: false };
    const result = await loadDataSource(src);
    expect(result.rows[0]).toMatchObject({ col0: 10, col1: 20 });
  });

  it('coerces boolean strings', async () => {
    const path = join(TMP, 'bool.csv');
    writeFileSync(path, 'flag\ntrue\nfalse\n');
    const src: DataSource = { id: 'b', type: 'csv', path };
    const result = await loadDataSource(src);
    expect(result.rows[0]['flag']).toBe(true);
    expect(result.rows[1]['flag']).toBe(false);
  });

  it('skips empty lines', async () => {
    const path = join(TMP, 'empty.csv');
    writeFileSync(path, 'a\n1\n\n2\n');
    const src: DataSource = { id: 'e', type: 'csv', path };
    const result = await loadDataSource(src);
    expect(result.rows).toHaveLength(2);
  });
});

describe('loadDataSource — unknown type', () => {
  it('returns empty rows', async () => {
    const src = { id: 'x', type: 'excel' } as DataSource;
    const result = await loadDataSource(src);
    expect(result.rows).toEqual([]);
  });
});

describe('loadAllSources', () => {
  it('loads multiple sources into map', async () => {
    const src1: DataSource = { id: 'a', type: 'inline', rows: [{ x: 1 }] };
    const src2: DataSource = { id: 'b', type: 'inline', rows: [{ y: 2 }] };
    const map = await loadAllSources([src1, src2]);
    expect(map.size).toBe(2);
    expect(map.get('a')?.rows[0]).toMatchObject({ x: 1 });
    expect(map.get('b')?.rows[0]).toMatchObject({ y: 2 });
  });
});
