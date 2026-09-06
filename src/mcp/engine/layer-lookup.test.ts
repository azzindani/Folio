import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { findDeep, scopesWithLayer, lockedAncestorOf, removeDeep, parentIdOf, findAllDeep } from './layer-lookup';

// Ops disagreed about what a layer is. update recursed into groups; remove,
// align and save_component scanned only the top level — and 267 of 279 real
// designs keep their layers inside a group. Worse, the carousel guard whose own
// comment calls it "the silent-nuke footgun" asked only about TOP-LEVEL ids, so
// an unscoped update on a group child sailed past it: measured live, opacity set
// on one id changed all three pages and the reply named one layer.

const rect = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10, ...extra } as unknown as Layer);
const group = (id: string, kids: Layer[], extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'group', z: 0, x: 0, y: 0, width: 100, height: 100, layers: kids, ...extra } as unknown as Layer);

describe('findDeep', () => {
  it('finds a layer nested several groups down', () => {
    const tree = [group('a', [group('b', [rect('deep')])])];
    expect(findDeep(tree, 'deep')?.layer.id).toBe('deep');
  });

  it('reports the NEAREST locked group above it', () => {
    const tree = [group('outer', [group('inner', [rect('x')], { locked: true })], { locked: true })];
    expect(findDeep(tree, 'x')?.lockedBy).toBe('outer');   // outermost lock is the one that binds
  });

  it('leaves lockedBy unset when nothing above is locked', () => {
    expect(findDeep([group('g', [rect('x')])], 'x')?.lockedBy).toBeUndefined();
  });

  it('does not descend into a non-group that happens to carry layers', () => {
    const odd = { id: 'weird', type: 'rect', z: 0, layers: [rect('hidden')] } as unknown as Layer;
    expect(findDeep([odd], 'hidden')).toBeNull();
  });
});

describe('scopesWithLayer — the carousel guard', () => {
  const page = (id: string): { id: string; layers: Layer[] } => ({ id, layers: [group('st', [rect('st_grain')])] });

  it('sees a GROUP CHILD shared by every page', () => {
    // The live failure: this used to return [] and the >1 check never fired.
    const spec = { pages: [page('p1'), page('p2'), page('p3')] } as unknown as DesignSpec;
    expect(scopesWithLayer(spec, 'st_grain')).toEqual(['p1', 'p2', 'p3']);
  });

  it('still sees a top-level id, as before', () => {
    const spec = { pages: [{ id: 'p1', layers: [rect('solo')] }] } as unknown as DesignSpec;
    expect(scopesWithLayer(spec, 'solo')).toEqual(['p1']);
  });

  it('names the root scope for a poster', () => {
    const spec = { layers: [group('g', [rect('kid')])] } as unknown as DesignSpec;
    expect(scopesWithLayer(spec, 'kid')).toEqual(['(root)']);
  });

  it('reports nothing for an id that is not there', () => {
    const spec = { layers: [rect('a')], pages: [] } as unknown as DesignSpec;
    expect(scopesWithLayer(spec, 'ghost')).toEqual([]);
  });
});

describe('lockedAncestorOf', () => {
  it('finds the lock through a page', () => {
    const spec = { pages: [{ id: 'p1', layers: [group('g', [rect('kid')], { locked: true })] }] } as unknown as DesignSpec;
    expect(lockedAncestorOf(spec, 'kid')).toBe('g');
  });

  it('is null for an unlocked subtree, and for a missing layer', () => {
    const spec = { layers: [group('g', [rect('kid')])] } as unknown as DesignSpec;
    expect(lockedAncestorOf(spec, 'kid')).toBeNull();
    expect(lockedAncestorOf(spec, 'ghost')).toBeNull();
  });

  it('scopes to one page when asked', () => {
    const spec = { pages: [
      { id: 'p1', layers: [group('g', [rect('kid')], { locked: true })] },
      { id: 'p2', layers: [group('g', [rect('kid')])] },
    ] } as unknown as DesignSpec;
    expect(lockedAncestorOf(spec, 'kid', 'p2')).toBeNull();
    expect(lockedAncestorOf(spec, 'kid', 'p1')).toBe('g');
  });
});

describe('removeDeep', () => {
  it('drops a nested layer and counts it', () => {
    const r = removeDeep([group('g', [rect('a'), rect('b')])], 'b');
    expect(r.removed).toBe(1);
    expect((r.layers[0] as unknown as { layers: Layer[] }).layers.map(l => l.id)).toEqual(['a']);
  });

  it('leaves the tree alone when the id is absent', () => {
    const r = removeDeep([group('g', [rect('a')])], 'ghost');
    expect(r.removed).toBe(0);
  });

  it('removes every occurrence, at any depth', () => {
    const r = removeDeep([group('g1', [rect('dup')]), group('g2', [rect('dup')])], 'dup');
    expect(r.removed).toBe(2);
  });
});

describe('parentIdOf / findAllDeep', () => {
  it('names the group directly containing a layer', () => {
    expect(parentIdOf([group('outer', [group('inner', [rect('x')])])], 'x')).toBe('inner');
  });

  it('is null for a top-level layer', () => {
    expect(parentIdOf([rect('x')], 'x')).toBeNull();
  });

  it('separates what it found from what it did not', () => {
    const r = findAllDeep([group('g', [rect('a'), rect('b')])], ['a', 'ghost', 'b']);
    expect(r.found.map(f => f.layer.id)).toEqual(['a', 'b']);
    expect(r.missing).toEqual(['ghost']);
  });
});
