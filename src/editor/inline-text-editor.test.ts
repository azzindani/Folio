/**
 * Tests for inline text editor (S6) and ruler guide lines (N12).
 * Uses StateManager + CanvasManager directly; DOM via jsdom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from './state';
import type { Guide } from './state';
import { CanvasManager } from './canvas';
import type { DesignSpec } from '../schema/types';

// jsdom stubs for pointer capture
HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();
SVGElement.prototype.getBBox = vi.fn(() => ({ x: 10, y: 20, width: 200, height: 40 })) as unknown as () => SVGRect;

function makeDesign(layers: DesignSpec['layers']): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function setup(): { state: StateManager; container: HTMLElement } {
  const state = new StateManager();
  const container = document.createElement('div');
  container.style.cssText = 'width:1200px;height:900px;position:relative';
  document.body.appendChild(container);
  new CanvasManager(container, state);
  return { state, container };
}

describe('Guide state management', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    ({ state, container } = setup());
  });
  afterEach(() => { container.remove(); });

  it('starts with no guides', () => {
    expect(state.get().guides).toEqual([]);
  });

  it('adding a guide is stored in state', () => {
    const guide: Guide = { id: 'g1', axis: 'h', position: 200 };
    state.set('guides', [guide], false);
    expect(state.get().guides).toHaveLength(1);
    expect(state.get().guides[0].position).toBe(200);
  });

  it('removing a guide filters by id', () => {
    const g1: Guide = { id: 'g1', axis: 'h', position: 100 };
    const g2: Guide = { id: 'g2', axis: 'v', position: 400 };
    state.set('guides', [g1, g2], false);
    state.set('guides', state.get().guides.filter(g => g.id !== 'g1'), false);
    expect(state.get().guides).toHaveLength(1);
    expect(state.get().guides[0].id).toBe('g2');
  });

  it('guide lines are rendered in the overlay when guides are set', () => {
    state.set('design', makeDesign([]));
    state.set('guides', [{ id: 'g1', axis: 'h', position: 300 }], false);
    const guideSvg = container.querySelector('.ruler-guide');
    expect(guideSvg).not.toBeNull();
  });

  it('guide overlay is cleared when guides list is emptied', () => {
    state.set('design', makeDesign([]));
    state.set('guides', [{ id: 'g1', axis: 'v', position: 200 }], false);
    state.set('guides', [], false);
    expect(container.querySelector('.ruler-guide')).toBeNull();
  });
});

describe('Inline text editor', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    ({ state, container } = setup());
  });
  afterEach(() => { container.remove(); });

  it('double-clicking a non-text layer does not open editor', () => {
    state.set('design', makeDesign([
      { id: 'r1', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 100, fill: { type: 'solid', color: '#fff' } } as unknown as DesignSpec['layers'][0],
    ]));
    const svgEl = container.querySelector('[data-layer-id="r1"]');
    if (svgEl) svgEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.inline-text-editor')).toBeNull();
  });

  it('double-clicking a text layer opens the textarea editor', () => {
    state.set('design', makeDesign([
      { id: 'txt1', type: 'text', z: 20, x: 10, y: 20, width: 200, height: 40,
        content: { type: 'plain', value: 'Hello World' },
        style: { font_family: 'Inter', font_size: 24, font_weight: 400, color: '#fff' },
      } as unknown as DesignSpec['layers'][0],
    ]));

    const layerEl = container.querySelector('[data-layer-id="txt1"]');
    expect(layerEl).not.toBeNull();
    layerEl!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = container.querySelector<HTMLTextAreaElement>('.inline-text-editor');
    expect(editor).not.toBeNull();
    expect(editor!.value).toBe('Hello World');
  });

  it('Escape closes editor without saving', () => {
    state.set('design', makeDesign([
      { id: 'txt2', type: 'text', z: 20, x: 0, y: 0, width: 150, height: 30,
        content: { type: 'plain', value: 'Original' },
        style: { font_size: 18 },
      } as unknown as DesignSpec['layers'][0],
    ]));

    container.querySelector('[data-layer-id="txt2"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = container.querySelector<HTMLTextAreaElement>('.inline-text-editor')!;
    editor.value = 'Changed';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(container.querySelector('.inline-text-editor')).toBeNull();
    const layers = state.getCurrentLayers();
    const layer = layers.find(l => l.id === 'txt2') as { content: { value: string } };
    expect(layer.content.value).toBe('Original');
  });

  it('Enter commits text change to state', () => {
    state.set('design', makeDesign([
      { id: 'txt3', type: 'text', z: 20, x: 0, y: 0, width: 150, height: 30,
        content: { type: 'plain', value: 'Old text' },
        style: { font_size: 18 },
      } as unknown as DesignSpec['layers'][0],
    ]));

    container.querySelector('[data-layer-id="txt3"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = container.querySelector<HTMLTextAreaElement>('.inline-text-editor')!;
    editor.value = 'New text';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(container.querySelector('.inline-text-editor')).toBeNull();
    const layer = state.getCurrentLayers().find(l => l.id === 'txt3') as { content: { value: string } };
    expect(layer.content.value).toBe('New text');
  });
});
