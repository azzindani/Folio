// Browser-safe dataset loading for the editor's live preview.
//
// src/report/data-loader.ts is the canonical loader, but its json/csv branches
// `await import('fs')` — pulling it into the editor bundle would drag a
// node-only module into the browser. The preview only ever needs what a browser
// can actually reach, so this module deliberately handles a narrower set:
//
//   inline        → rows carried in the design itself
//   api / query   → fetched over HTTP (same shape as loadHttp)
//   json / csv    → file-backed; unreachable from the browser. Falls back to
//                   `rows` if the source cached them, otherwise reports the
//                   source as unavailable so the preview can SAY SO rather
//                   than silently rendering an empty chart.
//
// A preview that quietly shows no data is worse than one that says why.

import type { DataSource } from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';

export interface PreviewDataResult {
  datasets: Map<string, LoadedDataset>;
  /** Sources that could not be loaded here, with the reason. */
  unavailable: { id: string; reason: string }[];
}

function pickRows(parsed: unknown, pick?: string): Record<string, unknown>[] {
  let value = parsed;
  if (pick && pick.trim()) {
    for (const key of pick.split('.')) {
      value = (value as Record<string, unknown> | null)?.[key];
    }
  }
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

async function loadOne(source: DataSource): Promise<LoadedDataset> {
  const cached = Array.isArray(source.rows) ? source.rows : [];

  switch (source.type) {
    case 'inline':
      return { id: source.id, rows: cached };

    case 'api':
    case 'query': {
      const url = source.url ?? source.path ?? '';
      // A query with a non-http engine needs a server-side connector the
      // browser has no route to — cached rows or nothing.
      if (source.type === 'query' && (source.engine ?? 'http') !== 'http') {
        if (cached.length > 0) return { id: source.id, rows: cached };
        throw new Error(`engine "${source.engine}" needs a server-side connector`);
      }
      if (!url) return { id: source.id, rows: cached };
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
      return { id: source.id, rows: pickRows(await res.json(), source.query) };
    }

    case 'json':
    case 'csv':
      if (cached.length > 0) return { id: source.id, rows: cached };
      throw new Error(`"${source.path ?? source.type}" is file-backed — not readable from the browser`);

    default:
      return { id: source.id, rows: cached };
  }
}

/**
 * Load every source a design declares. Never rejects: a failing source becomes
 * an `unavailable` entry so the rest of the report still previews.
 */
export async function loadPreviewDatasets(sources: DataSource[] | undefined): Promise<PreviewDataResult> {
  const datasets = new Map<string, LoadedDataset>();
  const unavailable: { id: string; reason: string }[] = [];
  if (!sources || sources.length === 0) return { datasets, unavailable };

  const settled = await Promise.allSettled(sources.map(s => loadOne(s)));
  settled.forEach((result, i) => {
    const source = sources[i];
    if (!source) return;
    if (result.status === 'fulfilled') {
      datasets.set(result.value.id, result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      unavailable.push({ id: source.id, reason });
      // Register an empty dataset so binder lookups miss cleanly instead of
      // throwing on an absent key.
      datasets.set(source.id, { id: source.id, rows: [] });
    }
  });

  return { datasets, unavailable };
}
