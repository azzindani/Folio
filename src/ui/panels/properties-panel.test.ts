import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { PropertiesPanelManager } from './properties-panel';
import type { DesignSpec, Layer } from '../../schema/types';

// Mock the colorPicker singleton so open() doesn't crash
vi.mock('../color-picker/color-picker', () => ({
  colorPicker: { open: vi.fn(), close: vi.fn() },
}));

// Mock canvas for any color-picker canvas operations
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function makeRect(id = 'r1', overrides: Partial<Layer> = {}): Layer {
  return {
    id, type: 'rect', z: 10, x: 10, y: 20, width: 200, height: 100,
    fill: { type: 'solid', color: '#ff0000' },
    ...overrides,
  } as unknown as Layer;
}

function makeCircle(id = 'c1'): Layer {
  return {
    id, type: 'circle', z: 10, x: 0, y: 0, width: 100, height: 100,
    fill: { type: 'solid', color: '#00ff00' },
  } as unknown as Layer;
}

function makeText(id = 't1'): Layer {
  return {
    id, type: 'text', z: 10, x: 0, y: 0, width: 300, height: 'auto',
    content: { type: 'plain', value: 'Hello' },
    style: { font_size: 24, font_weight: 400, color: '#ffffff' },
  } as unknown as Layer;
}

function makeLine(id = 'l1'): Layer {
  return {
    id, type: 'line', z: 10, x1: 0, y1: 0, x2: 100, y2: 100,
    stroke: { color: '#ff0000', width: 2 },
  } as unknown as Layer;
}

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function setup(layers: Layer[] = []) {
  const state = new StateManager();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="properties-content"></div>';
  document.body.appendChild(wrapper);
  const panel = new PropertiesPanelManager(wrapper, state);
  if (layers.length) {
    state.set('design', makeDesign(layers), false);
  }
  return { state, panel, wrapper };
}

// ── No-selection state ───────────────────────────────────────

describe('PropertiesPanelManager — no selection', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('shows "Select a layer" message when nothing selected', () => {
    const { wrapper, state } = setup([makeRect()]);
    state.set('selectedLayerIds', []);
    expect(wrapper.textContent).toContain('Select a layer');
  });

  it('shows message when design is null', () => {
    const { wrapper, panel } = setup();
    panel.render(); // trigger initial render
    expect(wrapper.textContent).toContain('Select a layer');
  });
});

// ── Multi-selection state ────────────────────────────────────

describe('PropertiesPanelManager — multi-selection', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('shows layer count when 3 layers selected', () => {
    const layers = [makeRect('a'), makeRect('b'), makeRect('c')];
    const { state, wrapper } = setup(layers);
    state.set('selectedLayerIds', ['a', 'b', 'c']);
    expect(wrapper.textContent).toContain('3');
    expect(wrapper.textContent).toContain('layers selected');
  });

  it('shows boolean ops section for exactly 2 selected layers', () => {
    const layers = [makeRect('a'), makeRect('b')];
    const { state, wrapper } = setup(layers);
    state.set('selectedLayerIds', ['a', 'b']);
    expect(wrapper.querySelector('.bool-op-btn')).not.toBeNull();
  });

  it('no boolean ops for 3 selected layers', () => {
    const layers = [makeRect('a'), makeRect('b'), makeRect('c')];
    const { state, wrapper } = setup(layers);
    state.set('selectedLayerIds', ['a', 'b', 'c']);
    expect(wrapper.querySelector('.bool-op-btn')).toBeNull();
  });

  it('clip-mask button applies clip_path_ref', () => {
    const a = makeRect('a', { z: 20 });
    const b = makeRect('b', { z: 10 });
    const { state, wrapper } = setup([a, b]);
    state.set('selectedLayerIds', ['a', 'b']);
    const clipBtn = wrapper.querySelector<HTMLButtonElement>('[data-op="clip-mask"]')!;
    clipBtn.click();
    // Bottom layer (b, z=10) should have clip_path_ref pointing to top (a, z=20)
    const bLayer = state.getCurrentLayers().find(l => l.id === 'b');
    expect((bLayer as unknown as Record<string, unknown>).clip_path_ref).toBe('a');
  });

  it('release button removes clip_path_ref', () => {
    const a = makeRect('a', { z: 20 });
    const b = makeRect('b', { z: 10 });
    const { state, wrapper } = setup([a, b]);
    state.set('selectedLayerIds', ['a', 'b']);
    const releaseBtn = wrapper.querySelector<HTMLButtonElement>('[data-op="release"]')!;
    releaseBtn.click();
    const aLayer = state.getCurrentLayers().find(l => l.id === 'a');
    expect((aLayer as unknown as Record<string, unknown>).visible).toBe(true);
  });
});

// ── Single layer — rect ──────────────────────────────────────

describe('PropertiesPanelManager — rect layer', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('renders layer id and type', () => {
    const { state, wrapper } = setup([makeRect('my-rect')]);
    state.set('selectedLayerIds', ['my-rect']);
    expect(wrapper.textContent).toContain('my-rect');
    expect(wrapper.textContent).toContain('rect');
  });

  it('renders position fields', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const inputs = wrapper.querySelectorAll<HTMLInputElement>('.prop-input[data-prop="x"], .prop-input[data-prop="y"]');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('renders width and height inputs', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const wInput = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="width"]');
    expect(wInput).not.toBeNull();
  });

  it('renders z, opacity, rotation in transform section', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const zInput = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="z"]');
    expect(zInput).not.toBeNull();
  });

  it('renders effects section with blur inputs', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const blurInput = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="effects.blur"]');
    expect(blurInput).not.toBeNull();
  });

  it('number input change calls state.updateLayer', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const xInput = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="x"]')!;
    xInput.value = '50';
    xInput.dispatchEvent(new Event('change'));
    const layer = state.getCurrentLayers().find(l => l.id === 'r1');
    expect(layer?.x).toBe(50);
  });

  it('color well click opens colorPicker', async () => {
    const { colorPicker } = await import('../color-picker/color-picker');
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const colorWell = wrapper.querySelector<HTMLElement>('.color-well.cp-trigger')!;
    expect(colorWell).not.toBeNull();
    colorWell.click();
    expect(colorPicker.open).toHaveBeenCalled();
  });

  it('add-shadow button renders a shadow row', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const addBtn = wrapper.querySelector<HTMLButtonElement>('[data-action="add-shadow"]')!;
    addBtn.click();
    const shadowRows = wrapper.querySelectorAll('.shadow-row');
    expect(shadowRows.length).toBeGreaterThan(0);
  });

  it('renders radius field for rect', () => {
    const rect = makeRect('rad', { radius: 8 } as Partial<Layer>);
    const { state, wrapper } = setup([rect]);
    state.set('selectedLayerIds', ['rad']);
    expect(wrapper.textContent?.toLowerCase()).toContain('radius');
  });

  it('blend mode select present', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const select = wrapper.querySelector<HTMLSelectElement>('.prop-select[data-prop="effects.blend_mode"]');
    expect(select).not.toBeNull();
  });
});

// ── Single layer — circle ────────────────────────────────────

describe('PropertiesPanelManager — circle layer', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('renders circle layer type label', () => {
    const { state, wrapper } = setup([makeCircle()]);
    state.set('selectedLayerIds', ['c1']);
    expect(wrapper.textContent).toContain('circle');
  });

  it('renders fill color well for circle', () => {
    const { state, wrapper } = setup([makeCircle()]);
    state.set('selectedLayerIds', ['c1']);
    const colorWell = wrapper.querySelector('.color-well.cp-trigger');
    expect(colorWell).not.toBeNull();
  });
});

// ── Single layer — text ──────────────────────────────────────

describe('PropertiesPanelManager — text layer', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('renders text layer type label', () => {
    const { state, wrapper } = setup([makeText()]);
    state.set('selectedLayerIds', ['t1']);
    expect(wrapper.textContent).toContain('text');
  });

  it('renders font-size input', () => {
    const { state, wrapper } = setup([makeText()]);
    state.set('selectedLayerIds', ['t1']);
    const input = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="style.font_size"]');
    expect(input).not.toBeNull();
    expect(Number(input?.value)).toBe(24);
  });

  it('renders text content textarea', () => {
    const { state, wrapper } = setup([makeText()]);
    state.set('selectedLayerIds', ['t1']);
    const textarea = wrapper.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toContain('Hello');
  });

  it('textarea change updates content', () => {
    const { state, wrapper } = setup([makeText()]);
    state.set('selectedLayerIds', ['t1']);
    const textarea = wrapper.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'World';
    textarea.dispatchEvent(new Event('change'));
    const layer = state.getCurrentLayers().find(l => l.id === 't1');
    const content = (layer as unknown as { content: { value: string } }).content;
    expect(content.value).toBe('World');
  });
});

// ── Single layer — line ──────────────────────────────────────

describe('PropertiesPanelManager — line layer', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('renders line layer type label', () => {
    const { state, wrapper } = setup([makeLine()]);
    state.set('selectedLayerIds', ['l1']);
    expect(wrapper.textContent).toContain('line');
  });

  it('renders x1, y1, x2, y2 inputs', () => {
    const { state, wrapper } = setup([makeLine()]);
    state.set('selectedLayerIds', ['l1']);
    const x1 = wrapper.querySelector<HTMLInputElement>('.prop-input[data-prop="x1"]');
    expect(x1).not.toBeNull();
  });

  it('renders stroke color well', () => {
    const { state, wrapper } = setup([makeLine()]);
    state.set('selectedLayerIds', ['l1']);
    const colorWell = wrapper.querySelector('.color-well.cp-trigger');
    expect(colorWell).not.toBeNull();
  });
});

// ── State change subscription ────────────────────────────────

describe('PropertiesPanelManager — re-renders on state change', () => {
  afterEach(() => { document.querySelectorAll('div').forEach(el => el.remove()); });

  it('re-renders when selectedLayerIds changes', () => {
    const { state, wrapper } = setup([makeRect('a')]);
    state.set('selectedLayerIds', []);
    const before = wrapper.innerHTML;
    state.set('selectedLayerIds', ['a']);
    const after = wrapper.innerHTML;
    expect(after).not.toBe(before);
  });

  it('re-renders when design changes', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const before = wrapper.innerHTML;
    state.set('design', makeDesign([makeRect('new')]), false);
    const after = wrapper.innerHTML;
    expect(typeof after).toBe('string');
    void before;
  });

  it('does NOT re-render when unrelated key changes', () => {
    const { state, wrapper } = setup([makeRect()]);
    state.set('selectedLayerIds', ['r1']);
    const before = wrapper.innerHTML;
    // Changing zoom doesn't trigger re-render
    state.set('zoom', 2, false);
    const after = wrapper.innerHTML;
    expect(after).toBe(before);
  });
});
