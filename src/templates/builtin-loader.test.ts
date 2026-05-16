import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadCatalogIndex,
  loadFullTemplate,
  findIndexEntry,
  peekTemplate,
  peekCatalogIndex,
  type CatalogIndexEntry,
} from './builtin-loader';

// The index is fetched as a Vite asset URL (`?url`). In vitest with
// jsdom, fetch resolves the URL against the test server which serves
// files from the project root. One awaited load before each block
// populates the module cache; sync helpers (findIndexEntry,
// peekCatalogIndex) then work as in production.

let INDEX: CatalogIndexEntry[];

beforeAll(async () => {
  INDEX = await loadCatalogIndex();
});

describe('catalog index (lazy-fetched metadata)', () => {
  it('loads index entries with required fields', () => {
    expect(INDEX.length).toBeGreaterThan(0);
    for (const e of INDEX) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.name).toBe('string');
      expect(typeof e.type).toBe('string');
      expect(Array.isArray(e.tags)).toBe(true);
      expect(typeof e.width).toBe('number');
      expect(typeof e.height).toBe('number');
      expect(typeof e.slots).toBe('number');
      expect(typeof e.pages).toBe('number');
      expect(e.file.endsWith('.template.yaml')).toBe(true);
    }
  });

  it('entries reference unique ids', () => {
    const ids = INDEX.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findIndexEntry returns by id', () => {
    const first = INDEX[0];
    expect(findIndexEntry(first.id)).toEqual(first);
    expect(findIndexEntry('___nope___')).toBeUndefined();
  });

  it('peekCatalogIndex returns the populated cache after load', () => {
    const cached = peekCatalogIndex();
    expect(cached).not.toBeNull();
    expect(cached!.length).toBe(INDEX.length);
  });

  it('loadCatalogIndex caches — subsequent calls resolve to the same array', async () => {
    const a = await loadCatalogIndex();
    const b = await loadCatalogIndex();
    expect(a).toBe(b);
  });
});

describe('loadFullTemplate (lazy)', () => {
  it('returns the full TemplateSpec for a known id', async () => {
    const first = INDEX[0];
    const spec  = await loadFullTemplate(first.id);
    expect(spec).toBeDefined();
    expect(spec?._protocol).toBe('template/v1');
    expect(spec?.meta?.id).toBe(first.id);
  });

  it('caches the result — peekTemplate after load returns same spec', async () => {
    const first = INDEX[0];
    const a = await loadFullTemplate(first.id);
    const b = peekTemplate(first.id);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it('returns undefined for an unknown id', async () => {
    const spec = await loadFullTemplate('___does-not-exist___');
    expect(spec).toBeUndefined();
  });

  it('deduplicates concurrent in-flight loads', async () => {
    const first = INDEX[0];
    const [a, b] = await Promise.all([
      loadFullTemplate(first.id),
      loadFullTemplate(first.id),
    ]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });
});
