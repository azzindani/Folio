import { describe, it, expect } from 'vitest';
import { ensurePages, addBlankPage, duplicatePage, deletePage, movePage, cloneLayersWithNewIds } from './state-pages';
import type { DesignSpec, Layer } from '../schema/types';

function rect(id: string): Layer {
  return { id, type: 'rect', z: 0, x: 0, y: 0, width: 10, height: 10, fill: { type: 'solid', color: '#fff' } } as unknown as Layer;
}

function singlePage(): DesignSpec {
  return {
    _protocol: 'design/v1', _mode: 'complete',
    meta: { id: 'd', name: 'D', type: 'poster', created: '', modified: '' },
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers: [rect('a'), rect('b')],
  } as unknown as DesignSpec;
}

describe('ensurePages', () => {
  it('lifts a single-page (root layers) design into pages[] and drops root layers', () => {
    const d = ensurePages(singlePage());
    expect(d.pages).toHaveLength(1);
    expect(d.pages?.[0].layers).toHaveLength(2);
    expect((d as { layers?: unknown }).layers).toBeUndefined();
  });
  it('leaves an already-paged design untouched', () => {
    const paged = { ...singlePage(), layers: undefined, pages: [{ id: 'p1', layers: [rect('x')] }] } as unknown as DesignSpec;
    expect(ensurePages(paged).pages).toHaveLength(1);
  });
});

describe('addBlankPage', () => {
  it('converts a single-page design and appends a blank page after current', () => {
    const { design, index } = addBlankPage(singlePage(), 0, 7);
    expect(design.pages).toHaveLength(2);
    expect(index).toBe(1);
    expect(design.pages?.[1].layers).toEqual([]);
    expect(design.pages?.[1].id).toBe('page-7');
  });
});

describe('duplicatePage', () => {
  it('clones a page with fresh layer ids and lands on the copy', () => {
    const base = ensurePages(singlePage());
    const { design, index } = duplicatePage(base, 0, 9);
    expect(design.pages).toHaveLength(2);
    expect(index).toBe(1);
    const orig = design.pages?.[0].layers?.map(l => l.id);
    const copy = design.pages?.[1].layers?.map(l => l.id);
    expect(copy).not.toEqual(orig);              // ids remapped
    expect(copy).toHaveLength(orig?.length ?? 0); // same count
    expect(new Set([...(orig ?? []), ...(copy ?? [])]).size).toBe(4); // all unique
  });
});

describe('deletePage', () => {
  it('removes a page but never the last one', () => {
    const two = addBlankPage(singlePage(), 0, 1).design;
    const { design, index } = deletePage(two, 1);
    expect(design.pages).toHaveLength(1);
    expect(index).toBe(0);
    // deleting the sole remaining page is a no-op
    expect(deletePage(design, 0).design.pages).toHaveLength(1);
  });
});

describe('movePage', () => {
  it('reorders pages and reports the moved index', () => {
    let d = ensurePages(singlePage());
    d = addBlankPage(d, 0, 1).design; // [p1, p2]
    d = addBlankPage(d, 1, 2).design; // [p1, p2, p3]
    const firstId = d.pages?.[0].id;
    const { design, index } = movePage(d, 0, 2);
    expect(index).toBe(2);
    expect(design.pages?.[2].id).toBe(firstId);
  });
});

describe('cloneLayersWithNewIds', () => {
  it('recurses into group children and remaps every id', () => {
    const group = { id: 'g', type: 'group', z: 0, layers: [rect('c1'), rect('c2')] } as unknown as Layer;
    const cloned = cloneLayersWithNewIds([group], 'x');
    const kids = (cloned[0] as Layer & { layers?: Layer[] }).layers;
    expect(cloned[0].id).toBe('x-0');
    expect(kids?.map(k => k.id)).toEqual(['x-1', 'x-2']);
  });
});
