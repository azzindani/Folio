import { describe, it, expect } from 'vitest';
import {
  loadCatalogIndex,
  loadFullTemplate,
  findIndexEntry,
  peekTemplate,
} from './builtin-loader';

describe('catalog index (eager metadata)', () => {
  it('loads index entries with required fields', () => {
    const index = loadCatalogIndex();
    expect(index.length).toBeGreaterThan(0);
    for (const e of index) {
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
    const ids = loadCatalogIndex().map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findIndexEntry returns by id', () => {
    const first = loadCatalogIndex()[0];
    expect(findIndexEntry(first.id)).toEqual(first);
    expect(findIndexEntry('___nope___')).toBeUndefined();
  });
});

describe('loadFullTemplate (lazy)', () => {
  it('returns the full TemplateSpec for a known id', async () => {
    const first = loadCatalogIndex()[0];
    const spec  = await loadFullTemplate(first.id);
    expect(spec).toBeDefined();
    expect(spec?._protocol).toBe('template/v1');
    expect(spec?.meta?.id).toBe(first.id);
  });

  it('caches the result — peekTemplate after load returns same spec', async () => {
    const first = loadCatalogIndex()[0];
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
    const first = loadCatalogIndex()[0];
    // Hit the loader from a fresh module is hard; instead, fire two in
    // parallel right after each other and confirm both resolve to the
    // same spec object (cache shared, no double-parse needed for
    // correctness — this is a smoke for the inflight dedupe path).
    const [a, b] = await Promise.all([
      loadFullTemplate(first.id),
      loadFullTemplate(first.id),
    ]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });
});
