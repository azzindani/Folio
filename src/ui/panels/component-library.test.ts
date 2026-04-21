import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentLibraryManager } from './component-library';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';

// Stub renderer so no real SVG is generated in tests
vi.mock('../../renderer/renderer', () => ({
  renderDesign: vi.fn(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    return svg;
  }),
}));

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 100, height: 100, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function makeRect(id: string): Layer {
  return { id, type: 'rect', z: 10, x: 0, y: 0, width: 50, height: 50, fill: { type: 'solid', color: '#fff' } } as unknown as Layer;
}

describe('ComponentLibraryManager', () => {
  let state: StateManager;
  let container: HTMLElement;
  let mgr: ComponentLibraryManager;

  beforeEach(() => {
    localStorage.clear();
    state = new StateManager();
    container = document.createElement('div');
    document.body.appendChild(container);
    mgr = new ComponentLibraryManager(container, state);
  });

  it('renders empty state when no components', () => {
    expect(container.querySelector('.comp-empty')).not.toBeNull();
  });

  it('shows Save button when layers are selected', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', ['a']);
    expect(container.querySelector('#comp-save')).not.toBeNull();
  });

  it('hides Save button when nothing is selected', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', []);
    expect(container.querySelector('#comp-save')).toBeNull();
  });

  it('saveSelected returns null when nothing selected', () => {
    state.set('design', makeDesign([makeRect('a')]));
    state.set('selectedLayerIds', []);
    const result = mgr.saveSelected('Test');
    expect(result).toBeNull();
  });

  it('saveSelected creates a component and renders a card', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    const def = mgr.saveSelected('My Button');
    expect(def).not.toBeNull();
    expect(def!.name).toBe('My Button');
    expect(container.querySelector('.comp-card')).not.toBeNull();
  });

  it('getComponents returns saved components', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('C1');
    mgr.saveSelected('C2');
    expect(mgr.getComponents().length).toBe(2);
  });

  it('saves components to localStorage', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('Persisted');
    const stored = JSON.parse(localStorage.getItem('folio:components') ?? '[]') as { name: string }[];
    expect(stored.some(c => c.name === 'Persisted')).toBe(true);
  });

  it('insertComponent adds a layer to the design', () => {
    state.set('design', makeDesign([makeRect('base')]));
    state.set('selectedLayerIds', ['base']);
    const def = mgr.saveSelected('ToInsert')!;
    state.set('selectedLayerIds', []);
    mgr.insertComponent(def.id);
    const layers = state.getCurrentLayers();
    // 'base' + inserted layer/group
    expect(layers.length).toBeGreaterThan(1);
  });

  it('deleteComponent removes it from the list', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    const def = mgr.saveSelected('ToDelete')!;
    mgr.deleteComponent(def.id);
    expect(mgr.getComponents().length).toBe(0);
    expect(container.querySelector('.comp-card')).toBeNull();
  });

  it('saved components persist after design re-render', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('Persistent');
    // Changing design triggers re-render; component cards should still be there
    state.set('design', makeDesign([makeRect('r2')]));
    expect(container.querySelectorAll('.comp-card').length).toBe(1);
  });

  it('clicking comp-insert button inserts the component', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('InsertMe');
    const insertBtn = container.querySelector<HTMLButtonElement>('.comp-insert')!;
    expect(insertBtn).not.toBeNull();
    insertBtn.click();
    // After insert, a new layer should be in the design
    const layers = state.getCurrentLayers();
    expect(layers.length).toBeGreaterThan(1);
  });

  it('clicking comp-delete button with confirm=false does not delete', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('DeleteMe');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const deleteBtn = container.querySelector<HTMLButtonElement>('.comp-delete')!;
    deleteBtn.click();
    expect(mgr.getComponents().length).toBe(1);
    vi.restoreAllMocks();
  });

  it('clicking comp-delete button with confirm=true deletes', () => {
    state.set('design', makeDesign([makeRect('r1')]));
    state.set('selectedLayerIds', ['r1']);
    mgr.saveSelected('DeleteConfirm');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteBtn = container.querySelector<HTMLButtonElement>('.comp-delete')!;
    deleteBtn.click();
    expect(mgr.getComponents().length).toBe(0);
    vi.restoreAllMocks();
  });
});
