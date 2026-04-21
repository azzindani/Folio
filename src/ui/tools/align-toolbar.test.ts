import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  afterEach(() => {
    container.remove();
  });

  it('builds toolbar eagerly in constructor (always present in DOM)', () => {
    new AlignToolbar(container, state);
    expect(container.querySelector('.align-toolbar')).not.toBeNull();
  });

  it('toolbar is visible with no selection (buttons just styled inactive)', () => {
    new AlignToolbar(container, state);
    const toolbar = container.querySelector('.align-toolbar') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.display).not.toBe('none');
  });

  it('buttons have reduced opacity when < 2 layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a']);
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    expect(btns[0].style.opacity).toBe('0.3');
  });

  it('creates 8 align buttons immediately after construction', () => {
    new AlignToolbar(container, state);
    const btns = container.querySelectorAll('.align-btn');
    expect(btns.length).toBe(8);
  });

  it('distribute buttons (indices 6-7) have reduced opacity when only 2 layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    // indices 0-5 (align) need minSelect=2 → full opacity with 2 selected
    expect(btns[0].style.opacity).toBe('1');
    // indices 6-7 (distribute) need minSelect=3 → inactive opacity with 2 selected
    expect(btns[6].style.opacity).toBe('0.3');
    expect(btns[7].style.opacity).toBe('0.3');
  });

  it('all buttons have full opacity when 3+ layers selected', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0,   y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
      { id: 'c', type: 'rect', z: 2, x: 200, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b', 'c']);
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    expect(btns[6].style.opacity).toBe('1');
    expect(btns[7].style.opacity).toBe('1');
  });

  it('buttons return to inactive opacity when selection drops below 2', () => {
    new AlignToolbar(container, state);
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    state.set('selectedLayerIds', ['a', 'b']);
    state.set('selectedLayerIds', ['a']);
    const toolbar = container.querySelector('.align-toolbar') as HTMLElement;
    // Toolbar stays in DOM
    expect(toolbar).not.toBeNull();
    const btns = container.querySelectorAll<HTMLButtonElement>('.align-btn');
    expect(btns[0].style.opacity).toBe('0.3');
  });

  it('clicking an active align button does not throw', () => {
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

  it('clicking an inactive button (no selection) is a no-op — no crash', () => {
    new AlignToolbar(container, state);
    const btn = container.querySelector<HTMLButtonElement>('.align-btn');
    // No layers selected → guard in click handler → no crash
    expect(() => btn!.click()).not.toThrow();
  });

  it('toolbar element is created exactly once (no duplicates)', () => {
    const layers = [
      { id: 'a', type: 'rect', z: 0, x: 0,   y: 0, width: 50, height: 50 },
      { id: 'b', type: 'rect', z: 1, x: 100, y: 0, width: 50, height: 50 },
      { id: 'c', type: 'rect', z: 2, x: 200, y: 0, width: 50, height: 50 },
    ] as Layer[];
    setDesignWithLayers(state, layers);
    new AlignToolbar(container, state);
    state.set('selectedLayerIds', ['a', 'b']);
    state.set('selectedLayerIds', ['a', 'b', 'c']);
    state.set('selectedLayerIds', ['a']);
    const toolbars = container.querySelectorAll('.align-toolbar');
    expect(toolbars.length).toBe(1);
  });
});
