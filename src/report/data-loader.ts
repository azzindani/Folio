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

    default:
      return { id: source.id, rows: [] };
  }
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
  const results = await Promise.all(sources.map(s => loadDataSource(s, baseDir)));
  return new Map(results.map(r => [r.id, r]));
}
