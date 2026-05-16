import { load as parseYAML } from 'js-yaml';
import type { EffectsPackSpec } from '../schema/types';
import indexUrl from './effects-pack-index.json?url';

export interface EffectsPackIndexEntry {
  id:          string;
  name:        string;
  tags:        string[];
  description: string;
  effectKeys:  string[];
  file:        string;
}

interface EffectsPackIndexFile {
  count:   number;
  entries: EffectsPackIndexEntry[];
}

let indexCache:    EffectsPackIndexEntry[] | null = null;
let indexInflight: Promise<EffectsPackIndexEntry[]> | null = null;

export async function loadEffectsPackIndex(): Promise<EffectsPackIndexEntry[]> {
  if (indexCache) return indexCache;
  if (indexInflight) return indexInflight;
  indexInflight = (async () => {
    try {
      const res  = await fetch(indexUrl);
      const data = (await res.json()) as EffectsPackIndexFile;
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

export function peekEffectsPackIndex(): EffectsPackIndexEntry[] | null {
  return indexCache;
}

export function findEffectsPackIndexEntry(id: string): EffectsPackIndexEntry | undefined {
  return indexCache?.find(e => e.id === id);
}

const EFFECTS_PACK_BASE = '/styles/effects-packs';

const specCache = new Map<string, EffectsPackSpec>();
const inflight  = new Map<string, Promise<EffectsPackSpec | undefined>>();

export async function loadFullEffectsPack(id: string): Promise<EffectsPackSpec | undefined> {
  if (specCache.has(id)) return specCache.get(id);
  const existing = inflight.get(id);
  if (existing) return existing;

  if (!indexCache) await loadEffectsPackIndex();
  const entry = findEffectsPackIndexEntry(id);
  if (!entry) return undefined;

  const url = `${EFFECTS_PACK_BASE}/${entry.file}`;
  const p = (async () => {
    try {
      const res  = await fetch(url);
      if (!res.ok) return undefined;
      const raw  = await res.text();
      const spec = parseYAML(raw) as EffectsPackSpec;
      if (!spec || spec._protocol !== 'effects-pack/v1') return undefined;
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

export function peekEffectsPack(id: string): EffectsPackSpec | undefined {
  return specCache.get(id);
}
