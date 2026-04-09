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
  });
});
