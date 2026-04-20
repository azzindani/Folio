import { describe, it, expect, vi } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec, Layer } from '../schema/types';

const makeDesign = (layers: Layer[]): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
  document: { width: 100, height: 100, unit: 'px', dpi: 96 },
  layers,
});

describe('StateManager', () => {
  it('initializes with default state', () => {
    const sm = new StateManager();
    const state = sm.get();
    expect(state.design).toBeNull();
    expect(state.zoom).toBe(1);
    expect(state.mode).toBe('visual');
    expect(state.selectedLayerIds).toEqual([]);
  });

  it('updates state and notifies listeners', () => {
    const sm = new StateManager();
    const listener = vi.fn();
    sm.subscribe(listener);
    sm.set('zoom', 2);
    expect(sm.get().zoom).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ zoom: 2 }), ['zoom']);
  });

  it('does not notify when value unchanged', () => {
    const sm = new StateManager();
    const listener = vi.fn();
    sm.subscribe(listener);
    sm.set('zoom', 1); // same as default
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes listener', () => {
    const sm = new StateManager();
    const listener = vi.fn();
    const unsub = sm.subscribe(listener);
    unsub();
    sm.set('zoom', 2);
    expect(listener).not.toHaveBeenCalled();
  });

  it('batches notifications', () => {
    const sm = new StateManager();
    const listener = vi.fn();
    sm.subscribe(listener);
    sm.batch(() => {
      sm.set('zoom', 2);
      sm.set('panX', 50);
      sm.set('panY', 100);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toContain('zoom');
    expect(listener.mock.calls[0][1]).toContain('panX');
    expect(listener.mock.calls[0][1]).toContain('panY');
  });

  describe('undo/redo', () => {
    it('undoes design changes', () => {
      const sm = new StateManager();
      const design1 = makeDesign([{ id: 'a', type: 'rect', z: 0 } as Layer]);
      const design2 = makeDesign([{ id: 'b', type: 'rect', z: 1 } as Layer]);

      sm.set('design', design1);
      sm.set('design', design2);

      sm.undo();
      expect(sm.get().design?.layers?.[0].id).toBe('a');
    });

    it('redoes undone changes', () => {
      const sm = new StateManager();
      const design1 = makeDesign([{ id: 'a', type: 'rect', z: 0 } as Layer]);
      const design2 = makeDesign([{ id: 'b', type: 'rect', z: 1 } as Layer]);

      sm.set('design', design1);
      sm.set('design', design2);
      sm.undo();
      sm.redo();

      expect(sm.get().design?.layers?.[0].id).toBe('b');
    });

    it('canUndo/canRedo report correctly', () => {
      const sm = new StateManager();
      expect(sm.canUndo()).toBe(false);
      expect(sm.canRedo()).toBe(false);

      sm.set('design', makeDesign([]));
      expect(sm.canUndo()).toBe(true); // can undo to null state

      sm.set('design', makeDesign([{ id: 'a', type: 'rect', z: 0 } as Layer]));
      expect(sm.canUndo()).toBe(true);

      sm.undo();
      expect(sm.canRedo()).toBe(true);
    });
  });

  describe('layer operations', () => {
    it('getCurrentLayers returns top-level layers', () => {
      const sm = new StateManager();
      const layers: Layer[] = [
        { id: 'a', type: 'rect', z: 0 } as Layer,
        { id: 'b', type: 'rect', z: 1 } as Layer,
      ];
      sm.set('design', makeDesign(layers));
      expect(sm.getCurrentLayers()).toHaveLength(2);
    });

    it('getSelectedLayers returns correct layers', () => {
      const sm = new StateManager();
      const layers: Layer[] = [
        { id: 'a', type: 'rect', z: 0 } as Layer,
        { id: 'b', type: 'rect', z: 1 } as Layer,
      ];
      sm.set('design', makeDesign(layers));
      sm.set('selectedLayerIds', ['b']);
      expect(sm.getSelectedLayers()).toHaveLength(1);
      expect(sm.getSelectedLayers()[0].id).toBe('b');
    });

    it('updateLayer modifies a layer property', () => {
      const sm = new StateManager();
      sm.set('design', makeDesign([
        { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100 } as Layer,
      ]));
      sm.updateLayer('a', { x: 50 });
      expect(sm.get().design?.layers?.[0].x).toBe(50);
    });

    it('addLayer appends a layer', () => {
      const sm = new StateManager();
      sm.set('design', makeDesign([
        { id: 'a', type: 'rect', z: 0 } as Layer,
      ]));
      sm.addLayer({ id: 'b', type: 'circle', z: 5 } as Layer);
      expect(sm.get().design?.layers).toHaveLength(2);
    });

    it('removeLayer removes a layer', () => {
      const sm = new StateManager();
      sm.set('design', makeDesign([
        { id: 'a', type: 'rect', z: 0 } as Layer,
        { id: 'b', type: 'rect', z: 1 } as Layer,
      ]));
      sm.removeLayer('a');
      expect(sm.get().design?.layers).toHaveLength(1);
      expect(sm.get().design?.layers?.[0].id).toBe('b');
    });

    it('removeLayer works on a paged design', () => {
      const sm = new StateManager();
      sm.set('design', {
        _protocol: 'design/v1',
        meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
        document: { width: 100, height: 100, unit: 'px', dpi: 96 },
        pages: [
          { id: 'p1', label: 'P1', layers: [
            { id: 'a', type: 'rect', z: 0 } as Layer,
            { id: 'b', type: 'rect', z: 1 } as Layer,
          ] },
          { id: 'p2', label: 'P2', layers: [{ id: 'c', type: 'rect', z: 0 } as Layer] },
        ],
      } as unknown as import('../schema/types').DesignSpec);
      sm.set('currentPageIndex', 0, false);
      sm.removeLayer('a');
      const pages = sm.get().design?.pages;
      expect(pages?.[0].layers).toHaveLength(1);
      expect(pages?.[1].layers).toHaveLength(1); // other page untouched
    });

    it('removeLayer removes nested child from a group', () => {
      const sm = new StateManager();
      const groupLayer: Layer = {
        id: 'grp', type: 'group', z: 0,
        layers: [{ id: 'child', type: 'rect', z: 0 } as Layer],
      } as unknown as Layer;
      sm.set('design', makeDesign([groupLayer]));
      sm.removeLayer('child');
      const topLayers = sm.get().design?.layers ?? [];
      const grp = topLayers.find(l => l.id === 'grp') as { layers: Layer[] };
      expect(grp?.layers).toHaveLength(0);
    });

    it('renameLayer renames a layer in a flat design', () => {
      const sm = new StateManager();
      sm.set('design', makeDesign([{ id: 'old', type: 'rect', z: 0 } as Layer]));
      sm.set('selectedLayerIds', ['old']);
      sm.renameLayer('old', 'new-name');
      const layers = sm.get().design?.layers ?? [];
      expect(layers[0].id).toBe('new-name');
      expect(sm.get().selectedLayerIds).toEqual(['new-name']);
    });

    it('renameLayer renames a layer in a paged design', () => {
      const sm = new StateManager();
      sm.set('design', {
        _protocol: 'design/v1',
        meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
        document: { width: 100, height: 100, unit: 'px', dpi: 96 },
        pages: [
          { id: 'p1', label: 'P1', layers: [{ id: 'layer1', type: 'rect', z: 0 } as Layer] },
        ],
      } as unknown as import('../schema/types').DesignSpec);
      sm.set('currentPageIndex', 0, false);
      sm.set('selectedLayerIds', ['layer1']);
      sm.renameLayer('layer1', 'renamed');
      const pages = sm.get().design?.pages;
      expect(pages?.[0].layers?.[0].id).toBe('renamed');
      expect(sm.get().selectedLayerIds).toContain('renamed');
    });

    it('renameLayer renames nested child in a group', () => {
      const sm = new StateManager();
      const groupLayer: Layer = {
        id: 'grp', type: 'group', z: 0,
        layers: [{ id: 'child', type: 'rect', z: 0 } as Layer],
      } as unknown as Layer;
      sm.set('design', makeDesign([groupLayer]));
      sm.renameLayer('child', 'child-renamed');
      const topLayers = sm.get().design?.layers ?? [];
      const grp = topLayers.find(l => l.id === 'grp') as { layers: Layer[] };
      expect(grp?.layers[0].id).toBe('child-renamed');
    });

    it('addLayer adds to paged design current page', () => {
      const sm = new StateManager();
      sm.set('design', {
        _protocol: 'design/v1',
        meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
        document: { width: 100, height: 100, unit: 'px', dpi: 96 },
        pages: [
          { id: 'p1', label: 'P1', layers: [] },
          { id: 'p2', label: 'P2', layers: [] },
        ],
      } as unknown as import('../schema/types').DesignSpec);
      sm.set('currentPageIndex', 0, false);
      sm.addLayer({ id: 'new', type: 'rect', z: 1 } as Layer);
      const pages = sm.get().design?.pages;
      expect(pages?.[0].layers).toHaveLength(1);
      expect(pages?.[1].layers).toHaveLength(0);
    });

    it('updateLayer updates layer in paged design', () => {
      const sm = new StateManager();
      sm.set('design', {
        _protocol: 'design/v1',
        meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
        document: { width: 100, height: 100, unit: 'px', dpi: 96 },
        pages: [
          { id: 'p1', label: 'P1', layers: [{ id: 'a', type: 'rect', z: 0, x: 0 } as Layer] },
        ],
      } as unknown as import('../schema/types').DesignSpec);
      sm.set('currentPageIndex', 0, false);
      sm.updateLayer('a', { x: 99 });
      const pages = sm.get().design?.pages;
      expect(pages?.[0].layers?.[0].x).toBe(99);
    });

    it('updateLayer updates nested child in a group', () => {
      const sm = new StateManager();
      const groupLayer: Layer = {
        id: 'grp', type: 'group', z: 0,
        layers: [{ id: 'child', type: 'rect', z: 0, x: 0 } as Layer],
      } as unknown as Layer;
      sm.set('design', makeDesign([groupLayer]));
      sm.updateLayer('child', { x: 42 });
      const topLayers = sm.get().design?.layers ?? [];
      const grp = topLayers.find(l => l.id === 'grp') as { layers: Layer[] };
      expect(grp?.layers[0].x).toBe(42);
    });
  });

  describe('set() undo control', () => {
    it('set(key, val, false) does not push undo for design changes', () => {
      const sm = new StateManager();
      expect(sm.canUndo()).toBe(false);
      const design = makeDesign([]);
      sm.set('design', design, false);
      expect(sm.canUndo()).toBe(false);
    });

    it('set(key, val, true) pushes undo for design changes', () => {
      const sm = new StateManager();
      sm.set('design', makeDesign([]));
      expect(sm.canUndo()).toBe(true);
    });

    it('undo on empty stack is a no-op', () => {
      const sm = new StateManager();
      expect(() => sm.undo()).not.toThrow();
    });

    it('redo on empty stack is a no-op', () => {
      const sm = new StateManager();
      expect(() => sm.redo()).not.toThrow();
    });
  });

  describe('getCurrentLayers for paged designs', () => {
    it('returns current page layers', () => {
      const sm = new StateManager();
      sm.set('design', {
        _protocol: 'design/v1',
        meta: { id: 't', name: 'T', type: 'carousel', created: '', modified: '' },
        document: { width: 100, height: 100, unit: 'px', dpi: 96 },
        pages: [
          { id: 'p1', label: 'P1', layers: [{ id: 'a', type: 'rect', z: 0 } as Layer] },
          { id: 'p2', label: 'P2', layers: [{ id: 'b', type: 'rect', z: 0 } as Layer] },
        ],
      } as unknown as import('../schema/types').DesignSpec);
      sm.set('currentPageIndex', 1, false);
      const layers = sm.getCurrentLayers();
      expect(layers).toHaveLength(1);
      expect(layers[0].id).toBe('b');
    });

    it('returns empty array when design is null', () => {
      const sm = new StateManager();
      expect(sm.getCurrentLayers()).toEqual([]);
    });
  });
});
