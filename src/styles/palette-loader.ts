import { load as parseYAML } from 'js-yaml';
import type { PaletteSpec } from '../schema/types';
// `?url` makes Vite emit the JSON as a hashed static asset rather than
// inlining it. Keeps the index out of the main bundle so authoring
// more palettes never costs bundle size.
import indexUrl from './palette-index.json?url';

// ── Public types ─────────────────────────────────────────────

export interface PaletteIndexEntry {
  id:          string;
  name:        string;
  tags:        string[];
  description: string;
  swatches:    string[];
  /** Filename under public/styles/palettes/, used by the lazy loader. */
  file:        string;
}

interface PaletteIndexFile {
  count:   number;
  entries: PaletteIndexEntry[];
}

// ── Index (lazy-fetched asset) ───────────────────────────────

let indexCache:    PaletteIndexEntry[] | null = null;
let indexInflight: Promise<PaletteIndexEntry[]> | null = null;

export async function loadPaletteIndex(): Promise<PaletteIndexEntry[]> {
  if (indexCache) return indexCache;
  if (indexInflight) return indexInflight;
  indexInflight = (async () => {
    try {
      const res  = await fetch(indexUrl);
      const data = (await res.json()) as PaletteIndexFile;
      indexCache = data.entries ?? [];
      return indexCache;
    } catch {
      indexCache = [];
      return indexCache;
    } finally {
      indexInflight = null;
    }
  })();
  return indexInflight;
}

export function peekPaletteIndex(): PaletteIndexEntry[] | null {
  return indexCache;
}

export function findPaletteIndexEntry(id: string): PaletteIndexEntry | undefined {
  return indexCache?.find(e => e.id === id);
}

// ── Full palette loader (lazy) ───────────────────────────────

const PALETTE_BASE = '/styles/palettes';

const specCache = new Map<string, PaletteSpec>();
const inflight  = new Map<string, Promise<PaletteSpec | undefined>>();

export async function loadFullPalette(id: string): Promise<PaletteSpec | undefined> {
  if (specCache.has(id)) return specCache.get(id);
  const existing = inflight.get(id);
  if (existing) return existing;

  if (!indexCache) await loadPaletteIndex();
  const entry = findPaletteIndexEntry(id);
  if (!entry) return undefined;

  const url = `${PALETTE_BASE}/${entry.file}`;
  const p = (async () => {
    try {
      const res  = await fetch(url);
      if (!res.ok) return undefined;
      const raw  = await res.text();
      const spec = parseYAML(raw) as PaletteSpec;
      if (!spec || spec._protocol !== 'palette/v1') return undefined;
      specCache.set(id, spec);
      return spec;
    } catch {
      return undefined;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

export function peekPalette(id: string): PaletteSpec | undefined {
  return specCache.get(id);
}
