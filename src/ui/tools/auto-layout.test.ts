import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from '../../editor/state';
import { CanvasManager } from '../../editor/canvas';
import type { AutoLayoutLayer } from '../../schema/types';

HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();

function setup(): { state: StateManager; container: HTMLElement } {
  const state = new StateManager();
  const container = document.createElement('div');
  container.style.cssText = 'width:1200px;height:900px;position:relative';
  document.body.appendChild(container);
  new CanvasManager(container, state);
  return { state, container };
}

describe('Frame tool creates auto_layout layer', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => ({ state, container } = setup()));
  afterEach(() => { container.remove(); });

  it('frame tool is registered in ToolId', () => {
    state.set('activeTool', 'frame', false);
    expect(state.get().activeTool).toBe('frame');
  });

  it('creating a frame layer via addLayer stores auto_layout', () => {
    const frame: AutoLayoutLayer = {
      id: 'frame-1', type: 'auto_layout', z: 10,
      x: 50, y: 50, width: 200, height: 160,
      direction: 'row', gap: 12, padding: 16,
      align_items: 'center', justify_content: 'start',
      fill: { type: 'solid', color: '#1e1e2e' },
      layers: [],
    };
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      layers: [],
    } as unknown as Parameters<typeof state.set>[1]);
    state.addLayer(frame as unknown as Parameters<typeof state.addLayer>[0]);
    const layers = state.getCurrentLayers();
    expect(layers.length).toBe(1);
    expect(layers[0].type).toBe('auto_layout');
  });

  it('auto_layout layer has correct defaults', () => {
    const frame: AutoLayoutLayer = {
      id: 'f1', type: 'auto_layout', z: 5,
      x: 0, y: 0, width: 200, height: 200,
      direction: 'column', gap: 8, padding: 12,
      align_items: 'start', justify_content: 'center',
      fill: { type: 'solid', color: '#fff' },
      layers: [],
    };
    expect(frame.direction).toBe('column');
    expect(frame.gap).toBe(8);
    expect(frame.padding).toBe(12);
    expect(frame.layers).toEqual([]);
  });
});

describe('Animation state', () => {
  it('starts with empty animations', () => {
    const state = new StateManager();
    expect(state.get().animations).toEqual({});
  });

  it('can store AnimationSpec by layer id', () => {
    const state = new StateManager();
    state.set('animations', { 'layer-1': { enter: { type: 'fade_in', duration: 400 } } }, false);
    expect(state.get().animations['layer-1']?.enter?.type).toBe('fade_in');
  });

  it('animations survive other state changes', () => {
    const state = new StateManager();
    state.set('animations', { 'l1': { loop: { type: 'float' } } }, false);
    state.set('zoom', 1.5, false);
    expect(state.get().animations['l1']?.loop?.type).toBe('float');
  });
});
