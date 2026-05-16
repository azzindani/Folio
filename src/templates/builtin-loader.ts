import { load as parseYAML } from 'js-yaml';
import type { TemplateSpec } from '../schema/template';
import catalogIndexJSON from './catalog-index.json';

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

// ── Index (eager, tiny) ──────────────────────────────────────

const INDEX: CatalogIndexEntry[] = (catalogIndexJSON as CatalogIndexFile).entries;

export function loadCatalogIndex(): CatalogIndexEntry[] {
  return INDEX;
}

export function findIndexEntry(id: string): CatalogIndexEntry | undefined {
  return INDEX.find(e => e.id === id);
}

// ── Full template loader (lazy) ──────────────────────────────

// Vite resolves the glob keys at build time. Non-eager: each value is a
// () => Promise<string> that fetches the YAML raw text on demand.
const rawLoaders = import.meta.glob<string>('./builtin/*.template.yaml', {
  query:  '?raw',
  import: 'default',
});

const specCache = new Map<string, TemplateSpec>();
const inflight  = new Map<string, Promise<TemplateSpec | undefined>>();

function loaderKeyFor(file: string): string {
  return `./builtin/${file}`;
}

export async function loadFullTemplate(id: string): Promise<TemplateSpec | undefined> {
  if (specCache.has(id)) return specCache.get(id);
  const existing = inflight.get(id);
  if (existing) return existing;

  const entry = findIndexEntry(id);
  if (!entry) return undefined;
  const key = loaderKeyFor(entry.file);
  const load = rawLoaders[key];
  if (!load) return undefined;

  const p = (async () => {
    try {
      const raw  = await load();
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
