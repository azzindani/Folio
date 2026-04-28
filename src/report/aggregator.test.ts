import { describe, it, expect } from 'vitest';
import {
  aggSum, aggAvg, aggMin, aggMax, aggCount,
  aggGroupBy, aggGroupBySum, evalDataExpr,
} from './aggregator';
import type { LoadedDataset } from './data-loader';

const rows = [
  { region: 'APAC', revenue: 100, delta: 10 },
  { region: 'EMEA', revenue: 200, delta: -5 },
  { region: 'APAC', revenue: 150, delta: 20 },
  { region: 'AMER', revenue: 300, delta: 5 },
];

describe('aggSum', () => {
  it('sums numeric field', () => expect(aggSum(rows, 'revenue')).toBe(750));
  it('returns 0 for empty rows', () => expect(aggSum([], 'revenue')).toBe(0));
  it('coerces string numbers', () => {
    expect(aggSum([{ v: '10' }, { v: '20' }] as never, 'v')).toBe(30);
  });
});

describe('aggAvg', () => {
  it('averages', () => expect(aggAvg(rows, 'revenue')).toBe(187.5));
  it('returns 0 for empty', () => expect(aggAvg([], 'revenue')).toBe(0));
});

describe('aggMin / aggMax', () => {
  it('min', () => expect(aggMin(rows, 'revenue')).toBe(100));
  it('max', () => expect(aggMax(rows, 'revenue')).toBe(300));
});

describe('aggCount', () => {
  it('counts rows', () => expect(aggCount(rows)).toBe(4));
  it('counts empty', () => expect(aggCount([])).toBe(0));
});

describe('aggGroupBy', () => {
  it('groups by field', () => {
    const groups = aggGroupBy(rows, 'region');
    expect(groups.size).toBe(3);
    expect(groups.get('APAC')).toHaveLength(2);
    expect(groups.get('EMEA')).toHaveLength(1);
  });
  it('handles missing field as empty string key', () => {
    const groups = aggGroupBy([{ x: 1 }] as never, 'missing');
    expect(groups.has('')).toBe(true);
  });
});

describe('aggGroupBySum', () => {
  it('returns group sums', () => {
    const result = aggGroupBySum(rows, 'region', 'revenue');
    const apac = result.find(r => r.group === 'APAC');
    expect(apac?.value).toBe(250);
  });
});

describe('evalDataExpr', () => {
  const ds: LoadedDataset = { id: 'sales', rows };
  const datasets = new Map([['sales', ds]]);

  it('$data.sales → full rows', () => {
    expect(evalDataExpr('$data.sales', datasets)).toEqual(rows);
  });

  it('$data.sales.length', () => {
    expect(evalDataExpr('$data.sales.length', datasets)).toBe(4);
  });

  it('$data.sales[1].revenue', () => {
    expect(evalDataExpr('$data.sales[1].revenue', datasets)).toBe(200);
  });

  it('$data.unknown returns []', () => {
    expect(evalDataExpr('$data.unknown', datasets)).toEqual([]);
  });

  it('$data.unknown.length returns 0', () => {
    expect(evalDataExpr('$data.unknown.length', datasets)).toBe(0);
  });

  it('$agg.sales.sum(revenue)', () => {
    expect(evalDataExpr('$agg.sales.sum(revenue)', datasets)).toBe(750);
  });

  it('$agg.sales.avg(revenue)', () => {
    expect(evalDataExpr('$agg.sales.avg(revenue)', datasets)).toBe(187.5);
  });

  it('$agg.sales.min(revenue)', () => {
    expect(evalDataExpr('$agg.sales.min(revenue)', datasets)).toBe(100);
  });

  it('$agg.sales.max(revenue)', () => {
    expect(evalDataExpr('$agg.sales.max(revenue)', datasets)).toBe(300);
  });

  it('$agg.sales.count()', () => {
    expect(evalDataExpr('$agg.sales.count()', datasets)).toBe(4);
  });

  it('$agg.sales.groupby(region).sum(revenue)', () => {
    const result = evalDataExpr('$agg.sales.groupby(region).sum(revenue)', datasets) as Array<{ group: string; value: number }>;
    const apac = result.find(r => r.group === 'APAC');
    expect(apac?.value).toBe(250);
  });

  it('$agg.sales.groupby(region).avg(revenue)', () => {
    const result = evalDataExpr('$agg.sales.groupby(region).avg(revenue)', datasets) as Array<{ group: string; value: number }>;
    const emea = result.find(r => r.group === 'EMEA');
    expect(emea?.value).toBe(200);
  });

  it('$agg.sales.groupby(region).min(revenue)', () => {
    const result = evalDataExpr('$agg.sales.groupby(region).min(revenue)', datasets) as Array<{ group: string; value: number }>;
    const apac = result.find(r => r.group === 'APAC');
    expect(apac?.value).toBe(100);
  });

  it('$agg.sales.groupby(region).max(revenue)', () => {
    const result = evalDataExpr('$agg.sales.groupby(region).max(revenue)', datasets) as Array<{ group: string; value: number }>;
    const apac = result.find(r => r.group === 'APAC');
    expect(apac?.value).toBe(150);
  });

  it('returns raw string for unrecognised expr', () => {
    expect(evalDataExpr('some.random.value', datasets)).toBe('some.random.value');
  });
});
