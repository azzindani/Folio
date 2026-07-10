import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec, Layer } from '../schema/types';
import {
  deleteSelected, duplicateSelected, adjustZ,
  groupSelected, ungroupSelected, toggleLockSelected,
} from './layer-actions';

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

function makeRect(id: string, x = 0, y = 0, z = 20): Layer {
  return { id, type: 'rect', z, x, y, width: 100, height: 100 } as Layer;
}

describe('layer-actions (shared by keyboard + context menu + panel)', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
    state.set('design', makeDesign([makeRect('a', 0, 0, 10), makeRect('b', 200, 0, 20)]));
  });

  it('deleteSelected removes the selection', () => {
    state.set('selectedLayerIds', ['a']);
    deleteSelected(state);
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['b']);
    expect(state.get().selectedLayerIds).toEqual([]);
  });

  it('duplicateSelected clones with offset', () => {
    state.set('selectedLayerIds', ['a']);
    duplicateSelected(state);
    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(3);
    const clone = layers.find(l => l.id.startsWith('a-copy-'))!;
    expect(clone.x).toBe(20);
    expect(clone.y).toBe(20);
  });

  it('adjustZ moves selection by ±10', () => {
    state.set('selectedLayerIds', ['b']);
    adjustZ(state, 1);
    expect(state.getCurrentLayers().find(l => l.id === 'b')!.z).toBe(30);
    adjustZ(state, -1);
    expect(state.getCurrentLayers().find(l => l.id === 'b')!.z).toBe(20);
  });

  it('groupSelected wraps 2+ layers and selects the group; ungroup restores', () => {
    state.set('selectedLayerIds', ['a', 'b']);
    groupSelected(state);
    const layers = state.getCurrentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('group');
    expect(state.get().selectedLayerIds).toEqual([layers[0].id]);

    ungroupSelected(state);
    expect(state.getCurrentLayers().map(l => l.id).sort()).toEqual(['a', 'b']);
  });

  it('groupSelected is a no-op for a single layer', () => {
    state.set('selectedLayerIds', ['a']);
    groupSelected(state);
    expect(state.getCurrentLayers()).toHaveLength(2);
  });

  it('toggleLockSelected locks all-unlocked, then unlocks', () => {
    state.set('selectedLayerIds', ['a', 'b']);
    toggleLockSelected(state);
    expect(state.getCurrentLayers().every(l => (l as { locked?: boolean }).locked)).toBe(true);
    state.set('selectedLayerIds', ['a', 'b']);
    toggleLockSelected(state);
    expect(state.getCurrentLayers().every(l => !(l as { locked?: boolean }).locked)).toBe(true);
  });
});
