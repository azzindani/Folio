import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadCollections, assignDesign, effectiveCollection, allCollections,
  relKey, isTestish, UNSORTED, DEFAULT_COLLECTIONS,
} from './library-collections';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-coll-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('library-collections — non-destructive collection overlay', () => {
  it('starts with the default collections and no assignments', () => {
    const s = loadCollections(root);
    expect(s.collections).toEqual([...DEFAULT_COLLECTIONS]);
    expect(s.assignments).toEqual({});
  });

  it('keys a design by its path relative to the projects root (portable)', () => {
    expect(relKey(root, path.join(root, 'frontier-lab', 'designs', 'arch.design.yaml')))
      .toBe('frontier-lab/designs/arch.design.yaml');
  });

  it('routes UNassigned designs by heuristic — test-ish project → Test, else Unsorted', () => {
    expect(isTestish('frontier-lab')).toBe(true);
    expect(isTestish('suite-014')).toBe(true);
    expect(isTestish('harness-run-3')).toBe(true);
    expect(isTestish('acme-quarterly-report')).toBe(false);
    const s = loadCollections(root);
    expect(effectiveCollection('frontier-lab/designs/a.design.yaml', 'frontier-lab', s)).toBe('Test');
    expect(effectiveCollection('acme/designs/a.design.yaml', 'acme', s)).toBe(UNSORTED);
  });

  it('persists an explicit assignment that overrides the heuristic', () => {
    const rel = 'frontier-lab/designs/keeper.design.yaml';
    assignDesign(root, rel, 'Real');
    const s = loadCollections(root);                 // re-read from disk
    expect(s.assignments[rel]).toBe('Real');
    expect(effectiveCollection(rel, 'frontier-lab', s)).toBe('Real');  // beats the "Test" guess
    expect(fs.existsSync(path.join(root, '.library', 'collections.json'))).toBe(true);
  });

  it('clears an assignment back to the heuristic when set to "" or Unsorted', () => {
    const rel = 'acme/designs/a.design.yaml';
    assignDesign(root, rel, 'Real');
    expect(loadCollections(root).assignments[rel]).toBe('Real');
    assignDesign(root, rel, UNSORTED);
    expect(loadCollections(root).assignments[rel]).toBeUndefined();    // back to default
    assignDesign(root, rel, 'Real');
    assignDesign(root, rel, '');
    expect(loadCollections(root).assignments[rel]).toBeUndefined();
  });

  it('registers a brand-new collection name so its tab survives an empty membership', () => {
    const rel = 'acme/designs/a.design.yaml';
    assignDesign(root, rel, 'Clients');
    expect(loadCollections(root).collections).toContain('Clients');
    assignDesign(root, rel, UNSORTED);               // move its only member out
    expect(loadCollections(root).collections).toContain('Clients');   // tab persists
  });

  it('builds the tab list: defaults ∪ curated ∪ in-use, Unsorted always last', () => {
    assignDesign(root, 'p/designs/x.design.yaml', 'Clients');
    const tabs = allCollections(loadCollections(root));
    expect(tabs).toEqual(['Real', 'Test', 'Clients', UNSORTED]);
    expect(tabs[tabs.length - 1]).toBe(UNSORTED);
  });

  it('survives a corrupt manifest by falling back to defaults', () => {
    fs.mkdirSync(path.join(root, '.library'), { recursive: true });
    fs.writeFileSync(path.join(root, '.library', 'collections.json'), '{ not valid json');
    const s = loadCollections(root);
    expect(s.collections).toEqual([...DEFAULT_COLLECTIONS]);
  });
});
