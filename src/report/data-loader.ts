import type { DataSource } from '../schema/types';

export interface LoadedDataset {
  id: string;
  rows: Record<string, unknown>[];
}

export async function loadDataSource(source: DataSource, baseDir?: string): Promise<LoadedDataset> {
  switch (source.type) {
    case 'inline':
      return { id: source.id, rows: source.rows ?? [] };

    case 'json':
      return loadJson(source, baseDir);

    case 'csv':
      return loadCsv(source, baseDir);

    case 'api':
      return loadHttp(source, source.url ?? source.path ?? '', source.query);

    case 'query':
      return loadQuery(source);

    default:
      return { id: source.id, rows: [] };
  }
}

// type:'query'. http = fetch a JSON endpoint (creds-free public data); sql/duckdb
// require a server-configured connector we don't ship — fail loudly rather than
// silently returning []. Cached rows (a prior fetch baked onto the source) are
// the fallback so an export still works offline.
async function loadQuery(source: DataSource): Promise<LoadedDataset> {
  const engine = source.engine ?? 'http';
  if (engine === 'http') return loadHttp(source, source.url ?? '', source.query);
  if (Array.isArray(source.rows) && source.rows.length > 0) return { id: source.id, rows: source.rows };
  throw new Error(`query engine "${engine}" needs a configured connector; no cached rows to fall back to for source "${source.id}"`);
}

// Fetch a JSON URL → rows. `pick` optionally selects a nested array by dot-path
// (e.g. "data.items"); otherwise the top-level array (or single object) is used.
async function loadHttp(source: DataSource, url: string, pick?: string): Promise<LoadedDataset> {
  if (!url) return { id: source.id, rows: source.rows ?? [] };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status} ${res.statusText}`);
  let parsed: unknown = await res.json();
  if (pick && pick.trim()) {
    for (const key of pick.split('.')) {
      parsed = (parsed as Record<string, unknown> | null)?.[key];
    }
  }
  const rows = Array.isArray(parsed)
    ? parsed as Record<string, unknown>[]
    : parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : [];
  return { id: source.id, rows };
}

async function loadJson(source: DataSource, baseDir?: string): Promise<LoadedDataset> {
  const path = resolvePath(source.path ?? '', baseDir);
  const { readFileSync } = await import('fs');
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [parsed as Record<string, unknown>];
  return { id: source.id, rows };
}

async function loadCsv(source: DataSource, baseDir?: string): Promise<LoadedDataset> {
  const path = resolvePath(source.path ?? '', baseDir);
  const { readFileSync } = await import('fs');
  const raw = readFileSync(path, 'utf-8');
  const rows = parseCsv(raw, source.delimiter ?? ',', source.headers !== false);
  return { id: source.id, rows };
}

function parseCsv(text: string, delimiter: string, hasHeaders: boolean): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = hasHeaders
    ? splitCsvLine(lines[0], delimiter)
    : lines[0].split(delimiter).map((_, i) => `col${i}`);

  const dataLines = hasHeaders ? lines.slice(1) : lines;
  return dataLines.map(line => {
    const values = splitCsvLine(line, delimiter);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const val = values[i] ?? '';
      row[h] = coerceValue(val);
    });
    return row;
  });
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function coerceValue(val: string): string | number | boolean {
  if (val === 'true') return true;
  if (val === 'false') return false;
  const num = Number(val);
  if (val !== '' && !Number.isNaN(num)) return num;
  return val;
}

function resolvePath(p: string, baseDir?: string): string {
  if (!baseDir) return p;
  const { join } = require('path') as { join: (...parts: string[]) => string };
  return join(baseDir, p);
}

export async function loadAllSources(
  sources: DataSource[],
  baseDir?: string,
): Promise<Map<string, LoadedDataset>> {
  // Pass 1: load every non-transform source.
  const base = sources.filter(s => s.type !== 'transform');
  const results = await Promise.all(base.map(s => loadDataSource(s, baseDir)));
  const map = new Map(results.map(r => [r.id, r]));
  // Pass 2: transform sources aggregate an already-loaded source. Computed here
  // (not loadDataSource) because they need the resolved upstream rows.
  const { computeGroupAgg } = await import('./aggregator');
  for (const t of sources.filter(s => s.type === 'transform')) {
    const fromRows = map.get(t.from ?? '')?.rows ?? [];
    const rows = t.group_by
      ? computeGroupAgg(fromRows, t.group_by, t.agg ?? 'sum', t.value)
      : (t.rows ?? []);
    map.set(t.id, { id: t.id, rows });
  }
  return map;
}
