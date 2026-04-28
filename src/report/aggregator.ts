import type { LoadedDataset } from './data-loader';

type Row = Record<string, unknown>;

function numVal(row: Row, field: string): number {
  const v = row[field];
  return typeof v === 'number' ? v : Number(v) || 0;
}

export function aggSum(rows: Row[], field: string): number {
  return rows.reduce((acc, r) => acc + numVal(r, field), 0);
}

export function aggAvg(rows: Row[], field: string): number {
  if (rows.length === 0) return 0;
  return aggSum(rows, field) / rows.length;
}

export function aggMin(rows: Row[], field: string): number {
  return Math.min(...rows.map(r => numVal(r, field)));
}

export function aggMax(rows: Row[], field: string): number {
  return Math.max(...rows.map(r => numVal(r, field)));
}

export function aggCount(rows: Row[]): number {
  return rows.length;
}

export function aggGroupBy(rows: Row[], groupField: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row[groupField] ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

export interface GroupedAggResult {
  group: string;
  value: number;
}

export function aggGroupBySum(rows: Row[], groupField: string, valueField: string): GroupedAggResult[] {
  const groups = aggGroupBy(rows, groupField);
  return Array.from(groups.entries()).map(([group, groupRows]) => ({
    group,
    value: aggSum(groupRows, valueField),
  }));
}

// ── Expression evaluator ────────────────────────────────────
// Evaluates $agg.* and $data.* expressions against loaded datasets.

export function evalDataExpr(
  expr: string,
  datasets: Map<string, LoadedDataset>,
): unknown {
  const trimmed = expr.trim();

  // $data.sourceId
  const dataMatch = trimmed.match(/^\$data\.(\w+)$/);
  if (dataMatch) {
    return datasets.get(dataMatch[1])?.rows ?? [];
  }

  // $data.sourceId.length
  const dataLenMatch = trimmed.match(/^\$data\.(\w+)\.length$/);
  if (dataLenMatch) {
    return datasets.get(dataLenMatch[1])?.rows.length ?? 0;
  }

  // $data.sourceId[N].field
  const dataIdxMatch = trimmed.match(/^\$data\.(\w+)\[(\d+)\]\.(\w+)$/);
  if (dataIdxMatch) {
    const rows = datasets.get(dataIdxMatch[1])?.rows ?? [];
    const idx = parseInt(dataIdxMatch[2], 10);
    return rows[idx]?.[dataIdxMatch[3]];
  }

  // $agg.sourceId.sum(field)
  const aggMatch = trimmed.match(/^\$agg\.(\w+)\.(sum|avg|min|max|count)\((\w*)\)$/);
  if (aggMatch) {
    const rows = datasets.get(aggMatch[1])?.rows ?? [];
    switch (aggMatch[2]) {
      case 'sum':   return aggSum(rows, aggMatch[3]);
      case 'avg':   return aggAvg(rows, aggMatch[3]);
      case 'min':   return aggMin(rows, aggMatch[3]);
      case 'max':   return aggMax(rows, aggMatch[3]);
      case 'count': return aggCount(rows);
    }
  }

  // $agg.sourceId.groupby(groupField).sum(valueField)
  const groupMatch = trimmed.match(/^\$agg\.(\w+)\.groupby\((\w+)\)\.(sum|avg|min|max)\((\w+)\)$/);
  if (groupMatch) {
    const rows = datasets.get(groupMatch[1])?.rows ?? [];
    const groups = aggGroupBy(rows, groupMatch[2]);
    const op = groupMatch[3];
    return Array.from(groups.entries()).map(([group, groupRows]) => ({
      group,
      value: op === 'sum' ? aggSum(groupRows, groupMatch[4])
           : op === 'avg' ? aggAvg(groupRows, groupMatch[4])
           : op === 'min' ? aggMin(groupRows, groupMatch[4])
           : aggMax(groupRows, groupMatch[4]),
    }));
  }

  return expr;
}
