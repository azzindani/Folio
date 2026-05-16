import { load as parseYAML } from 'js-yaml';
import type { TemplateSpec } from '../schema/template';
// `?url` makes Vite emit the JSON as a hashed static asset rather than
// inlining it into the main bundle. With 800+ entries the index is
// ~400KB — inlining busts the 500KB main-bundle budget.
import indexUrl from './catalog-index.json?url';

// ── Public types ─────────────────────────────────────────────

export interface CatalogIndexEntry {
  id:        string;
  name:      string;
  type:      string;
  tags:      string[];
  width:     number;
  height:    number;
  slots:     number;
  pages:     number;
  themeRef?: string;
  /** Filename under src/templates/builtin/, used by the lazy loader. */
  file:      string;
}

export interface BuiltinTemplate {
  id:   string;
  spec: TemplateSpec;
}

interface CatalogIndexFile {
  count:   number;
  entries: CatalogIndexEntry[];
}

// ── Index (lazy-fetched asset) ───────────────────────────────

let indexCache:    CatalogIndexEntry[] | null = null;
let indexInflight: Promise<CatalogIndexEntry[]> | null = null;

export async function loadCatalogIndex(): Promise<CatalogIndexEntry[]> {
  if (indexCache) return indexCache;
  if (indexInflight) return indexInflight;
  indexInflight = (async () => {
    try {
      const res  = await fetch(indexUrl);
      const data = (await res.json()) as CatalogIndexFile;
      indexCache = data.entries;
      return data.entries;
    } finally {
      indexInflight = null;
    }
  })();
  return indexInflight;
}

/**
 * Returns the loaded index synchronously, or null before
 * loadCatalogIndex() resolves. Use this from render-hot paths where
 * an awaited load already ran upstream (e.g. catalog dialog open).
 */
export function peekCatalogIndex(): CatalogIndexEntry[] | null {
  return indexCache;
}

export function findIndexEntry(id: string): CatalogIndexEntry | undefined {
  return indexCache?.find(e => e.id === id);
}

// ── Full template loader (lazy) ──────────────────────────────

// Templates live under public/templates/builtin/, served at runtime
// by the dev server / static host. Fetching by constructed URL means
// the bundle stays flat regardless of how many templates ship —
// `import.meta.glob` would register every path in the JS bundle and
// scale linearly with file count.
const BUILTIN_BASE = '/templates/builtin';

const specCache = new Map<string, TemplateSpec>();
const inflight  = new Map<string, Promise<TemplateSpec | undefined>>();

export async function loadFullTemplate(id: string): Promise<TemplateSpec | undefined> {
  if (specCache.has(id)) return specCache.get(id);
  const existing = inflight.get(id);
  if (existing) return existing;

  // Ensure the index is loaded so findIndexEntry can resolve.
  if (!indexCache) await loadCatalogIndex();
  const entry = findIndexEntry(id);
  if (!entry) return undefined;

  const url = `${BUILTIN_BASE}/${entry.file}`;
  const p = (async () => {
    try {
      const res  = await fetch(url);
      if (!res.ok) return undefined;
      const raw  = await res.text();
      const spec = parseYAML(raw) as TemplateSpec;
      if (!spec || spec._protocol !== 'template/v1') return undefined;
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

/** Pre-warm a batch (e.g. visible cards). Returns once all resolve. */
export async function preloadTemplates(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => loadFullTemplate(id)));
}

/** Synchronously read an already-loaded spec from the cache (or undefined). */
export function peekTemplate(id: string): TemplateSpec | undefined {
  return specCache.get(id);
}
