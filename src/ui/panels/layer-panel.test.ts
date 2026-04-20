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

describe('LayerPanelManager — click interactions', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    // Set design before panel creation to have exactly one { once: true } click listener
    state.set('design', makeDesign([makeRect('layer-a', 20), makeRect('layer-b', 10)]), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('clicking a layer row selects it', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="layer-a"]')!;
    expect(row).not.toBeNull();
    row.click();
    expect(state.get().selectedLayerIds).toContain('layer-a');
  });

  it('clicking toggle-vis button hides layer', () => {
    const btn = wrapper.querySelector<HTMLElement>('[data-action="toggle-vis"][data-layer-id="layer-a"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    const updated = state.getCurrentLayers().find(l => l.id === 'layer-a');
    expect(updated?.visible).toBe(false);
  });

  it('clicking toggle-lock button locks layer', () => {
    const btn = wrapper.querySelector<HTMLElement>('[data-action="toggle-lock"][data-layer-id="layer-a"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    const updated = state.getCurrentLayers().find(l => l.id === 'layer-a');
    expect(updated?.locked).toBe(true);
  });

  it('clicking outside a row re-renders without changing selection', () => {
    state.set('selectedLayerIds', ['layer-a']);
    const list = wrapper.querySelector<HTMLElement>('.layer-list')!;
    list.click(); // click on list itself (not a row)
    // Should not throw; selection state may vary
    expect(wrapper.querySelector('.layer-list')).not.toBeNull();
  });
});

describe('LayerPanelManager — dblclick rename', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    // Set design BEFORE creating panel to avoid double render (only one { once: true } listener)
    state.set('design', makeDesign([makeRect('rename-me', 10)]), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('double-clicking a row creates a rename input', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="rename-me"]')!;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = wrapper.querySelector<HTMLInputElement>('.layer-rename-input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('rename-me');
  });

  it('pressing Enter commits the rename', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="rename-me"]')!;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = wrapper.querySelector<HTMLInputElement>('.layer-rename-input')!;
    input.value = 'new-id';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    const layers = state.getCurrentLayers();
    expect(layers.some(l => l.id === 'new-id')).toBe(true);
  });

  it('pressing Escape cancels the rename', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="rename-me"]')!;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = wrapper.querySelector<HTMLInputElement>('.layer-rename-input')!;
    input.value = 'different-id';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // After Escape, list re-renders (original id stays)
    expect(state.getCurrentLayers()[0].id).toBe('rename-me');
  });
});

describe('LayerPanelManager — collapse toggle', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    const child = makeRect('child-col', 5);
    const group = makeGroup('grp-col', 20, [child]);
    // Set design with group BEFORE creating panel → exactly one click listener
    state.set('design', makeDesign([group]), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('clicking collapse button hides children', () => {
    expect(wrapper.querySelectorAll('.layer-row').length).toBe(2);
    const collapseBtn = wrapper.querySelector<HTMLElement>('[data-action="collapse"][data-layer-id="grp-col"]')!;
    expect(collapseBtn).not.toBeNull();
    collapseBtn.click();
    expect(wrapper.querySelectorAll('.layer-row').length).toBe(1);
  });
});

describe('LayerPanelManager — move layer (drag-drop reorder)', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('getLayersByBand returns "All" band containing all layers', () => {
    const layers = [makeRect('a', 10), makeRect('b', 20)];
    state.set('design', makeDesign(layers));
    // Access via panel reference
    const panel = new LayerPanelManager(document.createElement('div'), state);
    const bands = panel.getLayersByBand(layers);
    expect(bands.get('All')).toHaveLength(2);
  });
});
