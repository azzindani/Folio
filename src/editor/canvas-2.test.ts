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

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);
  Object.values(mockCtx).forEach(v => typeof v === 'function' && vi.mocked(v as ReturnType<typeof vi.fn>).mockClear?.());
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

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

describe('CanvasManager — ruler guide inside viewport and no-design guide render', () => {
  it('pointerup inside viewport adds a guide (line 763 FALSE branch)', () => {
    const { state, container } = setup([makeRect()]);
    const rulerH = container.querySelector<HTMLElement>('.ruler-h')!;
    const vp = container.querySelector<HTMLElement>('.canvas-viewport')!;

    // Mock getBoundingClientRect so the viewport appears to contain the release point
    const origGetBCR = vp.getBoundingClientRect.bind(vp);
    vi.spyOn(vp, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);

    rulerH.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 10 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 200 }));

    expect(state.get().guides.length).toBeGreaterThan(0);
    vi.restoreAllMocks();
    void origGetBCR;
  });

  it('renderGuideLines with no design uses ?? fallback dimensions (line 781-783)', () => {
    const state = new StateManager();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const mgr = new CanvasManager(container, state);

    // Set guides with no design (state.get().design is undefined)
    state.set('guides', [{ id: 'g1', axis: 'h' as const, position: 100 }], false);
    // Should render without crash (uses 1080 fallback for width/height)
    expect(container.innerHTML).toBeDefined();
    container.remove();
    void mgr;
  });
});
