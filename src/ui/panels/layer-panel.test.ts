/**
 * Unit tests for LayerPanelManager.
 * Tests virtual-scroll row building, selection, and rename behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { LayerPanelManager } from './layer-panel';
import type { DesignSpec, Layer } from '../../schema/types';

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    _mode: 'complete',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '2026-01-01', modified: '2026-01-01', generator: 'human' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function makeRect(id: string, z = 20): Layer {
  return { id, type: 'rect', z, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '#fff' } } as unknown as Layer;
}

describe('LayerPanelManager — getLayersByBand', () => {
  let state: StateManager;
  let panel: LayerPanelManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="layer-panel-content"></div>';
    document.body.appendChild(wrapper);
    panel = new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('groups layers by z-band correctly', () => {
    const layers = [
      makeRect('bg', 0),      // Background (0-9)
      makeRect('card', 10),   // Structural (10-19)
      makeRect('text', 20),   // Content (20-49)
      makeRect('fg', 75),     // Foreground (70-89)
    ];
    const map = panel.getLayersByBand(layers);

    expect(map.has('Background')).toBe(true);
    expect(map.get('Background')!.map(l => l.id)).toContain('bg');

    expect(map.has('Structural')).toBe(true);
    expect(map.get('Structural')!.map(l => l.id)).toContain('card');

    expect(map.has('Content')).toBe(true);
    expect(map.get('Content')!.map(l => l.id)).toContain('text');

    expect(map.has('Foreground')).toBe(true);
    expect(map.get('Foreground')!.map(l => l.id)).toContain('fg');
  });

  it('excludes empty bands from the result', () => {
    const layers = [makeRect('only-bg', 0)];
    const map = panel.getLayersByBand(layers);
    expect(map.has('Background')).toBe(true);
    expect(map.has('Content')).toBe(false);
    expect(map.has('Structural')).toBe(false);
  });

  it('sorts layers within a band by z descending', () => {
    const layers = [makeRect('z22', 22), makeRect('z20', 20), makeRect('z25', 25)];
    const map = panel.getLayersByBand(layers);
    const content = map.get('Content')!.map(l => l.id);
    expect(content).toEqual(['z25', 'z22', 'z20']);
  });

  it('returns empty map for empty input', () => {
    const map = panel.getLayersByBand([]);
    expect(map.size).toBe(0);
  });
});

describe('LayerPanelManager — render on state change', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="layer-panel-content"></div>';
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('renders "No layers" when design is empty', () => {
    state.set('design', makeDesign([]));
    const content = wrapper.querySelector('.layer-panel-content');
    expect(content?.textContent).toContain('No layers');
  });

  it('renders layer rows when design has layers', () => {
    state.set('design', makeDesign([makeRect('bg', 0), makeRect('text', 20)]));
    const rows = wrapper.querySelectorAll('.layer-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('selected layer row has "selected" class', () => {
    state.set('design', makeDesign([makeRect('bg', 0)]));
    state.set('selectedLayerIds', ['bg']);
    const selected = wrapper.querySelector('.layer-row.selected');
    expect(selected).not.toBeNull();
  });
});
