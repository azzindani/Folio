import { load as parseYAML } from 'js-yaml';
import type { TypePackSpec } from '../schema/types';
import indexUrl from './type-pack-index.json?url';

export interface TypePackIndexEntry {
  id:          string;
  name:        string;
  tags:        string[];
  description: string;
  families:    { heading: string; body: string; mono: string };
  file:        string;
}

interface TypePackIndexFile {
  count:   number;
  entries: TypePackIndexEntry[];
}

let indexCache:    TypePackIndexEntry[] | null = null;
let indexInflight: Promise<TypePackIndexEntry[]> | null = null;

export async function loadTypePackIndex(): Promise<TypePackIndexEntry[]> {
  if (indexCache) return indexCache;
  if (indexInflight) return indexInflight;
  indexInflight = (async () => {
    try {
      const res  = await fetch(indexUrl);
      const data = (await res.json()) as TypePackIndexFile;
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

export function peekTypePackIndex(): TypePackIndexEntry[] | null {
  return indexCache;
}

export function findTypePackIndexEntry(id: string): TypePackIndexEntry | undefined {
  return indexCache?.find(e => e.id === id);
}

const TYPE_PACK_BASE = '/styles/type-packs';

const specCache = new Map<string, TypePackSpec>();
const inflight  = new Map<string, Promise<TypePackSpec | undefined>>();

export async function loadFullTypePack(id: string): Promise<TypePackSpec | undefined> {
  if (specCache.has(id)) return specCache.get(id);
  const existing = inflight.get(id);
  if (existing) return existing;

  if (!indexCache) await loadTypePackIndex();
  const entry = findTypePackIndexEntry(id);
  if (!entry) return undefined;

  const url = `${TYPE_PACK_BASE}/${entry.file}`;
  const p = (async () => {
    try {
      const res  = await fetch(url);
      if (!res.ok) return undefined;
      const raw  = await res.text();
      const spec = parseYAML(raw) as TypePackSpec;
      if (!spec || spec._protocol !== 'type-pack/v1') return undefined;
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

export function peekTypePack(id: string): TypePackSpec | undefined {
  return specCache.get(id);
}
