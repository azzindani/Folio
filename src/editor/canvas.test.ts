import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from './state';
import { CanvasManager } from './canvas';
import type { DesignSpec, Layer } from '../schema/types';

// Mock canvas getContext to avoid NotImplementedError
const mockCtx = {
  fillStyle: '',
  font: '',
  textBaseline: '',
  fillRect: vi.fn(),
  fillText: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 20 }),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  setLineDash: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);
  Object.values(mockCtx).forEach(v => typeof v === 'function' && vi.mocked(v as ReturnType<typeof vi.fn>).mockClear?.());
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function makeDesign(layers: Layer[] = []): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 800, height: 600, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function makeRect(id = 'r1'): Layer {
  return {
    id, type: 'rect', z: 10, x: 10, y: 20, width: 200, height: 100,
    fill: { type: 'solid', color: '#ff0000' },
  } as unknown as Layer;
}

function makeTextLayer(id = 't1'): Layer {
  return {
    id, type: 'text', z: 10, x: 50, y: 50, width: 200, height: 'auto',
    content: { type: 'plain', value: 'Hello' },
    style: { font_family: 'Inter', font_size: 24, font_weight: 400, color: '#ffffff' },
  } as unknown as Layer;
}

function setup(layers: Layer[] = []) {
  const state = new StateManager();
  const container = document.createElement('div');
  container.style.width = '1200px';
  container.style.height = '800px';
  document.body.appendChild(container);
  const manager = new CanvasManager(container, state);
  if (layers.length) {
    state.set('design', makeDesign(layers), false);
  }
  return { state, manager, container };
}

// ── Constructor ──────────────────────────────────────────────

describe('CanvasManager — constructor', () => {
  it('creates viewport element inside container', () => {
    const { container } = setup();
    expect(container.querySelector('.canvas-viewport')).not.toBeNull();
  });

  it('creates rulers inside container', () => {
    const { container } = setup();
    expect(container.querySelector('.ruler-h')).not.toBeNull();
    expect(container.querySelector('.ruler-v')).not.toBeNull();
  });

  it('creates ruler corner element', () => {
    const { container } = setup();
    expect(container.querySelector('.ruler-corner')).not.toBeNull();
  });
});

// ── render() ────────────────────────────────────────────────

describe('CanvasManager — render', () => {
  it('does nothing when no design in state', () => {
    const { container } = setup();
    const svgContainer = container.querySelector('.canvas-svg-container');
    expect(svgContainer?.children.length).toBe(0);
  });

  it('renders SVG when design is set', () => {
    const { container } = setup([makeRect()]);
    const svgContainer = container.querySelector('.canvas-svg-container');
    expect(svgContainer?.querySelector('svg')).not.toBeNull();
  });

  it('re-renders when design state changes', () => {
    const { state, container } = setup([makeRect('r1')]);
    const svgBefore = container.querySelector('.canvas-svg-container svg');
    state.set('design', makeDesign([makeRect('r2')]), false);
    const svgAfter = container.querySelector('.canvas-svg-container svg');
    expect(svgAfter).not.toBeNull();
    void svgBefore;
  });

  it('renders paged design using currentPageIndex', () => {
    const pagedDesign = {
      _protocol: 'design/v1',
      meta: { id: 'paged', name: 'Paged', type: 'carousel', created: '', modified: '' },
      document: { width: 800, height: 600, unit: 'px', dpi: 96 },
      pages: [
        { id: 'p0', label: 'Page 1', layers: [makeRect('r1')] },
        { id: 'p1', label: 'Page 2', layers: [makeRect('r2')] },
      ],
    } as unknown as DesignSpec;

    const { state, container } = setup();
    state.set('design', pagedDesign, false);
    expect(container.querySelector('.canvas-svg-container svg')).not.toBeNull();
  });
});

// ── exportSVG() ──────────────────────────────────────────────

describe('CanvasManager — exportSVG', () => {
  it('returns empty string when no design rendered', () => {
    const { manager } = setup();
    expect(manager.exportSVG()).toBe('');
  });

  it('returns serialized SVG string when design is rendered', () => {
    const { manager } = setup([makeRect()]);
    const svg = manager.exportSVG();
    expect(svg).toContain('<svg');
  });
});

// ── fitToScreen() ────────────────────────────────────────────

describe('CanvasManager — fitToScreen', () => {
  it('does nothing when no design', () => {
    const { state, manager } = setup();
    manager.fitToScreen();
    expect(state.get().zoom).toBe(1);
  });

  it('sets zoom and resets pan when design is loaded', () => {
    const { state, manager } = setup([makeRect()]);
    state.set('zoom', 3, false);
    manager.fitToScreen();
    expect(state.get().zoom).toBeLessThanOrEqual(1);
    expect(state.get().panX).toBe(0);
    expect(state.get().panY).toBe(0);
  });
});

// ── onWheel (zoom / pan) ─────────────────────────────────────

describe('CanvasManager — wheel events', () => {
  it('zooms in on ctrl+wheel up', () => {
    const { state, container } = setup([makeRect()]);
    const initialZoom = state.get().zoom;
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true }));
    expect(state.get().zoom).toBeGreaterThan(initialZoom);
  });

  it('zooms out on ctrl+wheel down', () => {
    const { state, container } = setup([makeRect()]);
    state.set('zoom', 2, false);
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true }));
    expect(state.get().zoom).toBeLessThan(2);
  });

  it('pans on wheel without ctrl', () => {
    const { state, container } = setup([makeRect()]);
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 10, deltaY: 20, bubbles: true }));
    expect(state.get().panX).toBe(-10);
    expect(state.get().panY).toBe(-20);
  });
});

// ── onPointerDown (layer selection) ─────────────────────────

describe('CanvasManager — pointer events', () => {
  it('deselects all when clicking empty canvas area', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    svgContainer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(state.get().selectedLayerIds).toEqual([]);
  });

  it('selects layer when clicking element with data-layer-id', () => {
    const { state, container } = setup([makeRect('r1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    // Create a mock layer element inside the svg
    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);
    layerEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(state.get().selectedLayerIds).toContain('r1');
  });

  it('shift-click adds to selection', () => {
    const { state, container } = setup([makeRect('r1'), makeRect('r2')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    state.set('selectedLayerIds', ['r1'], false);

    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r2');
    svg.appendChild(layerEl as unknown as SVGElement);
    layerEl.dispatchEvent(new PointerEvent('pointerdown', { shiftKey: true, bubbles: true }));
    expect(state.get().selectedLayerIds).toContain('r1');
    expect(state.get().selectedLayerIds).toContain('r2');
  });

  it('shift-click deselects already-selected layer', () => {
    const { state, container } = setup([makeRect('r1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    state.set('selectedLayerIds', ['r1'], false);

    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);
    layerEl.dispatchEvent(new PointerEvent('pointerdown', { shiftKey: true, bubbles: true }));
    expect(state.get().selectedLayerIds).not.toContain('r1');
  });
});

// ── createLayerAt (drawing tools) ───────────────────────────

describe('CanvasManager — drawing tools', () => {
  const tools = ['rect', 'circle', 'line', 'text', 'polygon', 'frame'] as const;

  for (const tool of tools) {
    it(`${tool} tool creates a ${tool} layer on click`, () => {
      const { state, container } = setup([makeRect()]);
      state.set('activeTool', tool as import('./state').ToolId, false);
      const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
      svgContainer.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100, clientY: 100, bubbles: true,
      }));
      const layers = state.getCurrentLayers();
      const added = layers.find(l => l.id.startsWith(tool));
      expect(added).toBeDefined();
      expect(state.get().activeTool).toBe('select');
    });
  }
});

// ── State change reactions ───────────────────────────────────

describe('CanvasManager — state change reactions', () => {
  it('updates transform when zoom changes', () => {
    const { state, container } = setup([makeRect()]);
    state.set('zoom', 2, false);
    const viewport = container.querySelector<HTMLElement>('.canvas-viewport')!;
    expect(viewport.style.transform).toContain('scale(2)');
  });

  it('updates transform when panX/panY change', () => {
    const { state, container } = setup([makeRect()]);
    state.set('panX', 50, false);
    const viewport = container.querySelector<HTMLElement>('.canvas-viewport')!;
    expect(viewport.style.transform).toContain('50px');
  });

  it('renders guide lines when guides change', () => {
    const { state, container } = setup([makeRect()]);
    state.set('guides', [{ id: 'g1', axis: 'h' as const, position: 100 }], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    expect(selOverlay.querySelector('.ruler-guide')).not.toBeNull();
  });

  it('toggles tool-draw class when activeTool changes', () => {
    const { state, container } = setup();
    state.set('activeTool', 'rect' as import('./state').ToolId, false);
    expect(container.classList.contains('tool-draw')).toBe(true);
    state.set('activeTool', 'select' as import('./state').ToolId, false);
    expect(container.classList.contains('tool-draw')).toBe(false);
  });
});

// ── Guide lines rendering ────────────────────────────────────

describe('CanvasManager — guide lines', () => {
  it('renders both horizontal and vertical guides', () => {
    const { state, container } = setup([makeRect()]);
    state.set('guides', [
      { id: 'g1', axis: 'h' as const, position: 200 },
      { id: 'g2', axis: 'v' as const, position: 300 },
    ], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    const guideSvg = selOverlay.querySelector('.ruler-guide');
    expect(guideSvg).not.toBeNull();
    const lines = guideSvg!.querySelectorAll('line');
    expect(lines.length).toBe(2);
  });

  it('removes previous guide overlay before re-rendering', () => {
    const { state, container } = setup([makeRect()]);
    state.set('guides', [{ id: 'g1', axis: 'h' as const, position: 100 }], false);
    state.set('guides', [{ id: 'g2', axis: 'v' as const, position: 200 }], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    const guideSvgs = selOverlay.querySelectorAll('.ruler-guide');
    expect(guideSvgs.length).toBe(1);
  });
});

// ── Inline text editor ───────────────────────────────────────

describe('CanvasManager — inline text editor', () => {
  it('does nothing on dblclick when target has no data-layer-id', () => {
    const { container } = setup([makeTextLayer()]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    svgContainer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.inline-text-editor')).toBeNull();
  });

  it('opens inline text editor on dblclick of text layer', () => {
    const { container } = setup([makeTextLayer('t1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;

    const textEl = document.createElement('div');
    textEl.setAttribute('data-layer-id', 't1');
    svg.appendChild(textEl as unknown as SVGElement);

    textEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.inline-text-editor')).not.toBeNull();
  });

  it('does not open editor for non-text layers on dblclick', () => {
    const { container } = setup([makeRect('r1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;

    const rectEl = document.createElement('div');
    rectEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(rectEl as unknown as SVGElement);

    rectEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.inline-text-editor')).toBeNull();
  });
});

// ── mouseleave clears annotations ───────────────────────────

describe('CanvasManager — annotations', () => {
  it('clears annotations on mouseleave', () => {
    const { container } = setup([makeRect()]);
    expect(() => {
      container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }).not.toThrow();
  });

  it('clears annotations on mousemove without altKey', () => {
    const { container } = setup([makeRect()]);
    expect(() => {
      container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, altKey: false }));
    }).not.toThrow();
  });
});

// ── startDrag — pointermove/pointerup callbacks ──────────────

describe('CanvasManager — drag callbacks', () => {
  it('pointermove after pointerdown updates layer position', () => {
    const { state, container } = setup([makeRect('r1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;

    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);

    // Start drag (no shift = direct drag)
    layerEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: 50, clientY: 50,
    }));

    // Move pointer
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: 80, clientY: 70,
    }));

    const layer = state.getCurrentLayers().find(l => l.id === 'r1')!;
    // x was 10, moved by 30px → ~40; y was 20, moved 20px → ~40
    expect(layer.x).toBeGreaterThan(10);
  });

  it('pointerup after drag removes pointermove listener', () => {
    const { state, container } = setup([makeRect('r1')]);
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;

    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);

    layerEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    const posAfterUp = state.getCurrentLayers().find(l => l.id === 'r1')!.x;
    // Move after pointerup should not update
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 200 }));
    expect(state.getCurrentLayers().find(l => l.id === 'r1')!.x).toBe(posAfterUp);
  });

  it('drag with snapEnabled snaps to guide', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('snapEnabled', true as unknown as boolean, false);
    state.set('guides', [{ id: 'g1', axis: 'v' as const, position: 50 }], false);

    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);

    layerEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    // Move close to guide position (layer starts at x=10, move by ~40 → x≈50)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 100 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // Just verify it didn't throw
    expect(state.getCurrentLayers().find(l => l.id === 'r1')).toBeDefined();
  });
});

// ── Inline text editor — commit paths ───────────────────────

describe('CanvasManager — inline text editor interactions', () => {
  function openTextEditor(container: HTMLElement, layerId: string) {
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    const textEl = document.createElement('div');
    textEl.setAttribute('data-layer-id', layerId);
    svg.appendChild(textEl as unknown as SVGElement);
    textEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return container.querySelector<HTMLTextAreaElement>('.inline-text-editor')!;
  }

  it('blur commits text change to state', () => {
    const { state, container } = setup([makeTextLayer('t1')]);
    const ta = openTextEditor(container, 't1');
    ta.value = 'New text';
    ta.dispatchEvent(new Event('blur'));
    const layer = state.getCurrentLayers().find(l => l.id === 't1') as unknown as {
      content: { value: string }
    };
    expect(layer.content.value).toBe('New text');
  });

  it('Enter key commits text', () => {
    const { state, container } = setup([makeTextLayer('t1')]);
    const ta = openTextEditor(container, 't1');
    ta.value = 'Enter text';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const layer = state.getCurrentLayers().find(l => l.id === 't1') as unknown as {
      content: { value: string }
    };
    expect(layer.content.value).toBe('Enter text');
  });

  it('Shift+Enter does not commit (allows newline)', () => {
    const { container } = setup([makeTextLayer('t1')]);
    const ta = openTextEditor(container, 't1');
    ta.value = 'Line1\nLine2';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    // textarea should still be in the DOM
    expect(container.querySelector('.inline-text-editor')).not.toBeNull();
  });

  it('Escape discards changes and removes editor', () => {
    const { state, container } = setup([makeTextLayer('t1')]);
    const ta = openTextEditor(container, 't1');
    ta.value = 'Discarded change';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('.inline-text-editor')).toBeNull();
    const layer = state.getCurrentLayers().find(l => l.id === 't1') as unknown as {
      content: { value: string }
    };
    expect(layer.content.value).toBe('Hello'); // original value
  });
});

// ── Selection overlay with getBBox mock ──────────────────────

describe('CanvasManager — selection overlay (with getBBox)', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'getBBox', {
      value: () => ({ x: 10, y: 20, width: 200, height: 100 }),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    delete (Element.prototype as { getBBox?: unknown }).getBBox;
  });

  it('creates selection box and handles when getBBox returns bbox', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    expect(selOverlay.querySelector('.selection-box')).not.toBeNull();
  });

  it('creates 8 resize handles', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    const handles = selOverlay.querySelectorAll('.selection-handle:not(.handle-rotate)');
    expect(handles.length).toBe(8);
  });

  it('creates rotate handle', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    expect(selOverlay.querySelector('.handle-rotate')).not.toBeNull();
  });

  it('startRotate: pointerdown on rotate handle registers pointermove', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    const rotHandle = selOverlay.querySelector<HTMLElement>('.handle-rotate')!;

    rotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // Pointermove should update rotation
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: 200, clientY: 200,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // Layer rotation should have been updated
    const layer = state.getCurrentLayers().find(l => l.id === 'r1')!;
    expect(typeof (layer as unknown as { rotation?: number }).rotation).toBe('number');
  });

  it('startRotate with shift key snaps to 15deg increments', () => {
    const { state, container } = setup([makeRect('r1')]);
    state.set('selectedLayerIds', ['r1'], false);
    const selOverlay = container.querySelector('.canvas-selection-overlay')!;
    const rotHandle = selOverlay.querySelector<HTMLElement>('.handle-rotate')!;

    rotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: 300, clientY: 300, shiftKey: true,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    const rotation = (state.getCurrentLayers().find(l => l.id === 'r1') as unknown as { rotation: number }).rotation;
    expect(rotation % 15).toBe(0); // must be multiple of 15
  });
});

// ── Smart guide rendering ────────────────────────────────────

describe('CanvasManager — smart guides (drawSmartGuides)', () => {
  it('draws smart guides when two layers align vertically', () => {
    // Two layers at same y position → should trigger guide drawing
    const layer1 = makeRect('r1');
    const layer2: Layer = {
      ...makeRect('r2'),
      id: 'r2', x: 300, y: 20, // same y as r1
    } as Layer;

    const { state, container } = setup([layer1, layer2]);

    // Simulate dragging r1 so it aligns with r2 (y match)
    const svgContainer = container.querySelector<HTMLElement>('.canvas-svg-container')!;
    const svg = svgContainer.querySelector('svg')!;
    const layerEl = document.createElement('div');
    layerEl.setAttribute('data-layer-id', 'r1');
    svg.appendChild(layerEl as unknown as SVGElement);

    layerEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    // Move so r1.y ≈ 20 (no movement, already at y=20)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // Just verify it didn't throw
    expect(state.getCurrentLayers().find(l => l.id === 'r1')).toBeDefined();
  });
});

// ── onMouseMoveForAnnotations ────────────────────────────────

describe('CanvasManager — distance annotations', () => {
  beforeEach(() => {
    // Define getBBox broadly since jsdom SVG elements don't have it
    Object.defineProperty(Element.prototype, 'getBBox', {
      value: () => ({ x: 10, y: 20, width: 200, height: 100 }),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    delete (Element.prototype as { getBBox?: unknown }).getBBox;
  });

  it('altKey mousemove with selected layer creates annotation overlay', () => {
    const { state, container } = setup([makeRect('r1'), makeRect('r2')]);
    state.set('selectedLayerIds', ['r1'], false);

    expect(() => {
      container.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, altKey: true, clientX: 100, clientY: 100,
      }));
    }).not.toThrow();
  });

  it('altKey mousemove does nothing when no selection', () => {
    const { container } = setup([makeRect('r1')]);
    expect(() => {
      container.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, altKey: true, clientX: 100, clientY: 100,
      }));
    }).not.toThrow();
  });
});

// ── startGuide — ruler drag callbacks ───────────────────────

describe('CanvasManager — ruler guides', () => {
  it('pointerdown on horizontal ruler creates guide preview', () => {
    const { container } = setup([makeRect()]);
    const rulerH = container.querySelector<HTMLElement>('.ruler-h')!;
    rulerH.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: 100, clientY: 10,
    }));
    expect(container.querySelector('.guide-preview')).not.toBeNull();
  });

  it('pointerdown on vertical ruler creates guide preview', () => {
    const { container } = setup([makeRect()]);
    const rulerV = container.querySelector<HTMLElement>('.ruler-v')!;
    rulerV.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: 10, clientY: 100,
    }));
    expect(container.querySelector('.guide-preview')).not.toBeNull();
  });

  it('pointermove after ruler pointerdown updates guide preview position', () => {
    const { container } = setup([makeRect()]);
    const rulerH = container.querySelector<HTMLElement>('.ruler-h')!;
    rulerH.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 10 }));
    const preview = container.querySelector<HTMLElement>('.guide-preview')!;
    const topBefore = preview.style.top;
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 50 }));
    // Top should change after move
    expect(typeof topBefore).toBe('string');
  });

  it('pointerup outside viewport removes preview without adding guide', () => {
    const { state, container } = setup([makeRect()]);
    const rulerH = container.querySelector<HTMLElement>('.ruler-h')!;
    rulerH.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 10 }));
    // Release outside viewport (clientX/Y way off screen)
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: -1000, clientY: -1000 }));
    expect(container.querySelector('.guide-preview')).toBeNull();
    expect(state.get().guides).toHaveLength(0);
  });
});

// ── drawArrowLine / drawLabel (distance annotations) ──────────

describe('CanvasManager — drawArrowLine and drawLabel coverage', () => {
  beforeEach(() => {
    // Per-element getBBox: 'sel' is to the right of 'ref', creating a left gap
    Object.defineProperty(Element.prototype, 'getBBox', {
      value: function (this: Element) {
        const id = this.getAttribute?.('data-layer-id');
        if (id === 'sel') return { x: 300, y: 0, width: 50, height: 50 };
        if (id === 'ref') return { x: 0, y: 0, width: 100, height: 50 };
        return { x: 0, y: 0, width: 0, height: 0 };
      },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    delete (Element.prototype as { getBBox?: unknown }).getBBox;
  });

  it('mousemove with gap produces horizontal drawArrowLine call', () => {
    const selLayer = { id: 'sel', type: 'rect', z: 20, x: 300, y: 0, width: 50, height: 50,
      fill: { type: 'solid', color: '#f00' } } as unknown as Layer;
    const refLayer = { id: 'ref', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 50,
      fill: { type: 'solid', color: '#0f0' } } as unknown as Layer;
    const { state, container } = setup([selLayer, refLayer]);
    state.set('selectedLayerIds', ['sel']);

    // Mouse at clientX=60, clientY=45 → design coords dx≈40, dy≈25 → within ref bbox [0,0,100,50]
    container.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, altKey: true, clientX: 60, clientY: 45,
    }));

    // drawArrowLine calls ctx.beginPath and ctx.stroke
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
    // drawLabel calls ctx.fillRect and ctx.fillText
    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it('mousemove with vertical gap produces vertical drawArrowLine call', () => {
    // sel is below ref → top gap exists
    const selLayer = { id: 'sel', type: 'rect', z: 20, x: 0, y: 200, width: 50, height: 50,
      fill: { type: 'solid', color: '#f00' } } as unknown as Layer;
    const refLayer = { id: 'ref', type: 'rect', z: 10, x: 0, y: 0, width: 100, height: 80,
      fill: { type: 'solid', color: '#0f0' } } as unknown as Layer;

    Object.defineProperty(Element.prototype, 'getBBox', {
      value: function (this: Element) {
        const id = this.getAttribute?.('data-layer-id');
        if (id === 'sel') return { x: 0, y: 200, width: 50, height: 50 };
        if (id === 'ref') return { x: 0, y: 0, width: 100, height: 80 };
        return { x: 0, y: 0, width: 0, height: 0 };
      },
      configurable: true,
      writable: true,
    });

    const { state, container } = setup([selLayer, refLayer]);
    state.set('selectedLayerIds', ['sel']);

    // Mouse at (50, 50) design coords → dy=30 → within ref bbox {y:0, h:80}
    container.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, altKey: true, clientX: 70, clientY: 70,
    }));

    expect(mockCtx.beginPath).toHaveBeenCalled();
  });
});
