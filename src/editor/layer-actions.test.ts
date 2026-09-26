import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec, Layer } from '../schema/types';
import {
  deleteSelected, duplicateSelected, adjustZ,
  groupSelected, ungroupSelected, toggleLockSelected, detachSelected,
} from './layer-actions';
import { renderToSVGString } from '../mcp/engine/svg-export';

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

  it('detachSelected bakes a rule into what it draws, and one undo puts it back', () => {
    const ruled = { ...makeRect('r', 0, 0, 30), formulas: { x: '=W / 4' }, animation: { rule: { preset: 'rise', at: 300 } } } as unknown as Layer;
    const cells = { id: 'g', type: 'group', z: 40, x: 0, y: 600, width: 900, height: 100, layers: [],
      gallery: { items: 3, gap: 30, template: [makeRect('cell')] } } as unknown as Layer;
    state.set('design', makeDesign([ruled, cells]));
    const before = renderToSVGString(state.get().design as DesignSpec);
    state.set('selectedLayerIds', ['r', 'g']);
    detachSelected(state);
    const [r, g] = state.getCurrentLayers() as (Layer & { formulas?: object; gallery?: object; layers?: Layer[]; animation?: { rule?: unknown; keyframes?: unknown[] } })[];
    expect(r).toMatchObject({ x: 270 });
    expect(r?.formulas).toBeUndefined();
    expect(r?.animation?.rule).toBeUndefined();
    expect(r?.animation?.keyframes?.length).toBeGreaterThan(1);
    expect(g?.gallery).toBeUndefined();
    expect(g?.layers?.map(c => c.id)).toEqual(['g_1', 'g_2', 'g_3']);
    expect(renderToSVGString(state.get().design as DesignSpec)).toBe(before);
    state.undo();
    expect((state.getCurrentLayers()[0] as { animation?: { rule?: unknown } }).animation?.rule).toEqual({ preset: 'rise', at: 300 });
  });
});
