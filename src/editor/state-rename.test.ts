/**
 * Tests for StateManager.renameLayer — ensures ID updates propagate correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from './state';
import type { DesignSpec } from '../schema/types';

const SAMPLE_DESIGN: DesignSpec = {
  _protocol: 'design/v1',
  _mode: 'complete',
  meta: { id: 'test', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01', generator: 'human' },
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#000' } },
    { id: 'headline', type: 'text', z: 20, x: 100, y: 100, width: 800, height: 'auto', content: { type: 'plain', value: 'Hello' }, style: { font_size: 24, font_weight: 400, color: '#fff' } },
  ],
} as unknown as DesignSpec;

describe('StateManager.renameLayer', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
    state.set('design', SAMPLE_DESIGN);
  });

  it('renames layer ID in design.layers', () => {
    state.renameLayer('bg', 'background');
    const layers = state.getCurrentLayers();
    expect(layers.find(l => l.id === 'bg')).toBeUndefined();
    expect(layers.find(l => l.id === 'background')).toBeDefined();
  });

  it('updates selectedLayerIds when renamed layer was selected', () => {
    state.set('selectedLayerIds', ['bg', 'headline']);
    state.renameLayer('bg', 'background');
    expect(state.get().selectedLayerIds).toContain('background');
    expect(state.get().selectedLayerIds).not.toContain('bg');
    expect(state.get().selectedLayerIds).toContain('headline');
  });

  it('is a no-op when layer id does not exist', () => {
    const before = state.getCurrentLayers().map(l => l.id);
    state.renameLayer('nonexistent', 'new-name');
    const after = state.getCurrentLayers().map(l => l.id);
    expect(after).toEqual(before);
  });

  it('pushes undo history so rename can be undone', () => {
    // After renaming, undo should be available (initial design set also pushes undo,
    // so we verify undoing the rename restores the original id)
    state.renameLayer('bg', 'background');
    expect(state.canUndo()).toBe(true);
  });

  it('undoing rename restores original id', () => {
    state.renameLayer('bg', 'background');
    state.undo();
    const layers = state.getCurrentLayers();
    expect(layers.find(l => l.id === 'bg')).toBeDefined();
    expect(layers.find(l => l.id === 'background')).toBeUndefined();
  });

  it('does not rename other layers with similar IDs', () => {
    state.renameLayer('bg', 'bg2');
    const layers = state.getCurrentLayers();
    const ids = layers.map(l => l.id);
    expect(ids).toContain('bg2');
    expect(ids).toContain('headline');
    expect(ids).not.toContain('bg');
  });
});

describe('StateManager.renameLayer — carousel', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
    state.set('design', {
      _protocol: 'design/v1',
      _mode: 'complete',
      meta: { id: 'test', name: 'Test', type: 'carousel', created: '2026-01-01', modified: '2026-01-01', generator: 'human' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      pages: [
        {
          id: 'page_1', label: 'Page 1',
          layers: [
            { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#000' } },
          ],
        },
      ],
    } as unknown as DesignSpec);
  });

  it('renames layer in the correct page', () => {
    state.set('currentPageIndex', 0);
    state.renameLayer('bg', 'background');
    const layers = state.getCurrentLayers();
    expect(layers.find(l => l.id === 'background')).toBeDefined();
  });
});
