import { describe, it, expect, beforeEach } from 'vitest';
import { AlignToolbar } from './align-toolbar';
import { StateManager } from '../../editor/state';
import type { DesignSpec, Layer } from '../../schema/types';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function setDesignWithLayers(state: StateManager, layers: Layer[]): void {
  state.set('design', {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'X', type: 'poster', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px' },
    layers,
  } as unknown as DesignSpec);
}

describe('AlignToolbar', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
  });

  it('does not build toolbar when no selection', () => {
    new AlignToolbar(container, state);
    expect(container.querySelector('.align-toolbar')).toBeNull();
  });

  it('does not show toolbar with fewer than 2 selections', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a']);
    expect(container.querySelector('.align-toolbar')).toBeNull();
  });

  it('builds and shows toolbar when ≥2 layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    const toolbar = container.querySelector('.align-toolbar') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.display).toBe('flex');
  });

  it('creates 8 align buttons', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    const btns = container.querySelectorAll('.align-btn');
    expect(btns.length).toBe(8);
  });

  it('distribute buttons are disabled when only 2 layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    // Distribute buttons (indices 6 & 7) need minSelect=3
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    expect(btns[6].disabled).toBe(true);
    expect(btns[7].disabled).toBe(true);
  });

  it('all buttons enabled when 3+ layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0,   y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
      { id: 'c', type: 'rect', z: 2, x: 200, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b', 'c']);
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    expect(btns[6].disabled).toBe(false);
    expect(btns[7].disabled).toBe(false);
  });

  it('hides toolbar when selection drops below 2', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    state.set('selectedLayerIds', ['a']);
    const toolbar = container.querySelector('.align-toolbar') as HTMLElement;
    expect(toolbar.style.display).toBe('none');
  });

  it('clicking an align button does not throw (calls align fn)', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0,   y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    const btn = container.querySelector<HTMLButtonElement>('.align-btn');
    expect(() => btn!.click()).not.toThrow();
  });

  it('show() called twice only builds toolbar once (line 50 false branch)', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0,   y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
      { id: 'c', type: 'rect', z: 2, x: 200, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);       // first show → build()
    state.set('selectedLayerIds', ['a', 'b', 'c']); // second show → no rebuild
    const toolbars = container.querySelectorAll('.align-toolbar');
    expect(toolbars.length).toBe(1);
  });
});
