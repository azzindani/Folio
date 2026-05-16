import type { LoadedDataset } from './data-loader';

/**
 * Normalizes column values to consistent types across the dataset.
 * Detects and casts numeric columns, trims string values.
 */
export function normalizeDataset(dataset: LoadedDataset): LoadedDataset {
  if (dataset.rows.length === 0) return dataset;

  const sample = dataset.rows[0];
  const numericCols = Object.keys(sample).filter(k =>
    dataset.rows.every(r => r[k] === undefined || r[k] === null || r[k] === '' || !Number.isNaN(Number(r[k])))
    && dataset.rows.some(r => r[k] !== undefined && r[k] !== null && r[k] !== '')
  );

  const rows = dataset.rows.map(row => {
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        normalized[k] = v;
      } else if (numericCols.includes(k) && typeof v === 'string') {
        normalized[k] = v === '' ? null : Number(v);
      } else if (typeof v === 'string') {
        normalized[k] = v.trim();
      } else {
        normalized[k] = v;
      }
    }
    return normalized;
  });

  return { id: dataset.id, rows };
}

export function normalizeAll(datasets: Map<string, LoadedDataset>): Map<string, LoadedDataset> {
  const out = new Map<string, LoadedDataset>();
  for (const [id, ds] of datasets) {
    out.set(id, normalizeDataset(ds));
  }
  return out;
}
