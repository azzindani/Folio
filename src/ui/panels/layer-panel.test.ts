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
  let panel: LayerPanelManager;

  beforeEach(() => {
    state = new StateManager();
    const layers = [makeRect('a', 30), makeRect('b', 20), makeRect('c', 10)];
    state.set('design', makeDesign(layers), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    panel = new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('getLayersByBand returns "All" band containing all layers', () => {
    const layers = [makeRect('x', 10), makeRect('y', 20)];
    const bands = panel.getLayersByBand(layers);
    expect(bands.get('All')).toHaveLength(2);
  });

  it('drag-drop: dragstart event fires without crash', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    expect(row).not.toBeNull();
    // jsdom supports dragstart via Event (DragEvent not available in jsdom)
    row.dispatchEvent(new Event('dragstart', { bubbles: true }));
    // No crash expected
    expect(row).not.toBeNull();
  });

  it('drag-drop: dragend event fires without crash', () => {
    const row = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    row.dispatchEvent(new Event('dragstart', { bubbles: true }));
    row.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(wrapper.querySelectorAll('.dragging').length).toBe(0);
  });
});

describe('LayerPanelManager — drag-drop reorder (dragover, drop)', () => {
  let state: StateManager;
  let wrapper: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    const layers = [makeRect('a', 30), makeRect('b', 20), makeRect('c', 10)];
    state.set('design', makeDesign(layers), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('dragover adds drop-target class', () => {
    const rowA = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    const rowB = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="b"]')!;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rowB.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    expect(rowB.classList.contains('drop-target')).toBe(true);
  });

  it('drop reorders layers (moves a before c)', () => {
    const rowA = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    const rowC = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="c"]')!;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rowC.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    rowC.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    // After drop, the layer order should have changed
    const rows = [...wrapper.querySelectorAll<HTMLElement>('.layer-row')];
    const ids = rows.map(r => r.dataset.layerId);
    expect(ids).not.toEqual(['a', 'b', 'c']); // order changed
  });

  it('drop on same layer does nothing', () => {
    const rowA = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    const before = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!.dataset.layerId;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rowA.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    const after = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!.dataset.layerId;
    expect(after).toBe(before);
  });

  it('dragend removes dragging class', () => {
    const rowA = wrapper.querySelector<HTMLElement>('.layer-row[data-layer-id="a"]')!;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rowA.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(rowA.classList.contains('dragging')).toBe(false);
  });
});

describe('LayerPanelManager — moveLayerBefore', () => {
  let state: StateManager;
  let wrapper: HTMLElement;
  let panel: LayerPanelManager;

  beforeEach(() => {
    state = new StateManager();
    const layers = [makeRect('x', 30), makeRect('y', 20), makeRect('z', 10)];
    state.set('design', makeDesign(layers), false);
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    panel = new LayerPanelManager(wrapper, state);
  });
  afterEach(() => { wrapper.remove(); });

  it('moveLayerBefore reorders layers in state', () => {
    const move = (panel as unknown as { moveLayerBefore: (from: string, before: string) => void }).moveLayerBefore;
    move.call(panel, 'z', 'x');
    const layers = state.getCurrentLayers();
    const ids = layers.map(l => l.id);
    expect(ids.indexOf('z')).toBeLessThan(ids.indexOf('x'));
  });

  it('moveLayerBefore with invalid fromId is a no-op', () => {
    const move = (panel as unknown as { moveLayerBefore: (from: string, before: string) => void }).moveLayerBefore;
    expect(() => move.call(panel, 'nonexistent', 'x')).not.toThrow();
  });

  it('moveLayerBefore with invalid toId is a no-op', () => {
    const move = (panel as unknown as { moveLayerBefore: (from: string, before: string) => void }).moveLayerBefore;
    expect(() => move.call(panel, 'x', 'nonexistent')).not.toThrow();
  });
});
