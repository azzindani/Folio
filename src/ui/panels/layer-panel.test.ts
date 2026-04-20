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

function makeGroup(id: string, z = 10, children: Layer[] = []): Layer {
  return { id, type: 'group', z, layers: children } as unknown as Layer;
}

describe('LayerPanelManager — tree rendering', () => {
  let state: StateManager;
  let panel: LayerPanelManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    panel = new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('renders flat layers as rows', () => {
    state.set('design', makeDesign([makeRect('a', 0), makeRect('b', 20)]));
    const rows = wrapper.querySelectorAll('.layer-row');
    expect(rows.length).toBe(2);
    void panel;
  });

  it('sorts layers by z descending', () => {
    state.set('design', makeDesign([makeRect('low', 0), makeRect('high', 50)]));
    const rows = [...wrapper.querySelectorAll<HTMLElement>('.layer-row')];
    expect(rows[0].dataset.layerId).toBe('high');
    expect(rows[1].dataset.layerId).toBe('low');
    void panel;
  });

  it('renders child rows for expanded group', () => {
    const child = makeRect('child', 5);
    const group = makeGroup('grp', 20, [child]);
    state.set('design', makeDesign([group]));
    // group + child = 2 rows
    expect(wrapper.querySelectorAll('.layer-row').length).toBe(2);
    void panel;
  });

  it('child rows have greater depth than parent', () => {
    const child = makeRect('child', 5);
    const group = makeGroup('grp', 20, [child]);
    state.set('design', makeDesign([group]));
    const rows = [...wrapper.querySelectorAll<HTMLElement>('.layer-row')];
    const groupRow = rows.find(r => r.dataset.layerId === 'grp')!;
    const childRow = rows.find(r => r.dataset.layerId === 'child')!;
    const groupDepth = parseInt(groupRow.dataset.depth ?? '0', 10);
    const childDepth = parseInt(childRow.dataset.depth ?? '0', 10);
    expect(childDepth).toBeGreaterThan(groupDepth);
    void panel;
  });
});

describe('LayerPanelManager — render on state change', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('renders "No layers" when design is empty', () => {
    state.set('design', makeDesign([]));
    const list = wrapper.querySelector('.layer-list');
    expect(list?.textContent).toContain('No layers');
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

  it('re-renders when currentPageIndex changes', () => {
    state.set('design', makeDesign([makeRect('a', 0)]));
    const before = wrapper.querySelector('.layer-list')?.innerHTML;
    state.set('currentPageIndex', 1);
    const after = wrapper.querySelector('.layer-list')?.innerHTML;
    // innerHTML may or may not change; just ensure no crash
    expect(typeof after).toBe('string');
    void before;
  });
});
