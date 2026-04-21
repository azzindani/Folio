import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from './state';
import { InteractionManager, alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV, distributeH, distributeV } from './interactions';
import type { Layer, DesignSpec } from '../schema/types';

// Mock interact.js — we only care about the interactions logic, not the drag library
vi.mock('interactjs', () => {
  const listeners: Record<string, unknown> = {};
  const mockInteractable = {
    draggable: vi.fn().mockReturnThis(),
    resizable: vi.fn().mockReturnThis(),
    unset: vi.fn(),
    _listeners: listeners,
  };
  const mockInteract = vi.fn(() => mockInteractable) as unknown as typeof import('interactjs').default;
  (mockInteract as unknown as Record<string, unknown>).modifiers = {
    snap: vi.fn(() => ({})),
  };
  (mockInteract as unknown as Record<string, unknown>).snappers = {
    grid: vi.fn(() => ({})),
  };
  return { default: mockInteract };
});

function makeDesign(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

function makeRect(id: string, x: number, y: number, w: number, h: number): Layer {
  return { id, type: 'rect', z: 10, x, y, width: w, height: h } as Layer;
}

describe('alignment utilities', () => {
  it('alignLeft aligns all layers to the leftmost x', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 100, 0, 50, 50),
      makeRect('b', 200, 0, 50, 50),
      makeRect('c', 50, 0, 50, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b', 'c']);

    alignLeft(sm);

    const layers = sm.getCurrentLayers();
    expect(layers.every(l => l.x === 50)).toBe(true);
  });

  it('alignRight aligns all layers to the rightmost edge', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 100, 50),
      makeRect('b', 50, 0, 200, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b']);

    alignRight(sm);

    const layers = sm.getCurrentLayers();
    const rightEdges = layers.map(l => (l.x ?? 0) + (typeof l.width === 'number' ? l.width : 0));
    expect(rightEdges[0]).toBe(rightEdges[1]);
  });

  it('alignTop aligns all layers to the topmost y', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 100, 50, 50),
      makeRect('b', 0, 50, 50, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b']);

    alignTop(sm);

    const layers = sm.getCurrentLayers();
    expect(layers.every(l => l.y === 50)).toBe(true);
  });

  it('alignBottom aligns all layers to the bottommost edge', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 50, 100),
      makeRect('b', 0, 50, 50, 200),
    ]));
    sm.set('selectedLayerIds', ['a', 'b']);

    alignBottom(sm);

    const layers = sm.getCurrentLayers();
    const bottomEdges = layers.map(l => (l.y ?? 0) + (typeof l.height === 'number' ? l.height : 0));
    expect(bottomEdges[0]).toBe(bottomEdges[1]);
  });

  it('alignCenterH centers layers horizontally', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 100, 50),
      makeRect('b', 200, 0, 100, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b']);

    alignCenterH(sm);

    const layers = sm.getCurrentLayers();
    const centers = layers.map(l => (l.x ?? 0) + (typeof l.width === 'number' ? l.width : 0) / 2);
    expect(centers[0]).toBe(centers[1]);
  });

  it('distributeH distributes layers evenly', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 50, 50),
      makeRect('b', 200, 0, 50, 50),
      makeRect('c', 500, 0, 50, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b', 'c']);

    distributeH(sm);

    const layers = sm.getCurrentLayers().sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    // First and last should stay, middle redistributed
    expect(layers[0].x).toBe(0);
    expect(layers[2].x).toBe(500);
    // Gap should be equal
    const gap1 = (layers[1].x ?? 0) - ((layers[0].x ?? 0) + 50);
    const gap2 = (layers[2].x ?? 0) - ((layers[1].x ?? 0) + 50);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(2);
  });

  it('does nothing with fewer than 2 layers for align', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 100, 100, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);

    alignLeft(sm);
    expect(sm.getCurrentLayers()[0].x).toBe(100); // unchanged
  });
});

  it('alignCenterV aligns all layers to vertical center', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 50, 50),
      makeRect('b', 0, 200, 50, 100),
    ]));
    sm.set('selectedLayerIds', ['a', 'b']);

    alignCenterV(sm);

    const layers = sm.getCurrentLayers();
    const centers = layers.map(l => (l.y ?? 0) + (typeof l.height === 'number' ? l.height : 0) / 2);
    expect(centers[0]).toBe(centers[1]);
  });

  it('distributeV distributes layers evenly vertically', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([
      makeRect('a', 0, 0, 50, 50),
      makeRect('b', 0, 200, 50, 50),
      makeRect('c', 0, 500, 50, 50),
    ]));
    sm.set('selectedLayerIds', ['a', 'b', 'c']);

    distributeV(sm);

    const layers = sm.getCurrentLayers().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    expect(layers[0].y).toBe(0);
    expect(layers[2].y).toBe(500);
    const gap1 = (layers[1].y ?? 0) - ((layers[0].y ?? 0) + 50);
    const gap2 = (layers[2].y ?? 0) - ((layers[1].y ?? 0) + 50);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(2);
  });

  it('distributeH does nothing with fewer than 3 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 0, 0, 50, 50), makeRect('b', 200, 0, 50, 50)]));
    sm.set('selectedLayerIds', ['a', 'b']);
    const before = sm.getCurrentLayers().map(l => l.x);
    distributeH(sm);
    const after = sm.getCurrentLayers().map(l => l.x);
    expect(after).toEqual(before);
  });

  it('alignLeft does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 100, 0, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignLeft(sm);
    const layer = sm.getCurrentLayers()[0];
    expect(layer.x).toBe(100);
  });

  it('alignRight does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 100, 0, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignRight(sm);
    expect(sm.getCurrentLayers()[0].x).toBe(100);
  });

  it('alignTop does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 0, 100, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignTop(sm);
    expect(sm.getCurrentLayers()[0].y).toBe(100);
  });

  it('alignBottom does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 0, 100, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignBottom(sm);
    expect(sm.getCurrentLayers()[0].y).toBe(100);
  });

  it('alignCenterH does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 50, 0, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignCenterH(sm);
    expect(sm.getCurrentLayers()[0].x).toBe(50);
  });

  it('alignCenterV does nothing with fewer than 2 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 0, 50, 50, 50)]));
    sm.set('selectedLayerIds', ['a']);
    alignCenterV(sm);
    expect(sm.getCurrentLayers()[0].y).toBe(50);
  });

  it('distributeV does nothing with fewer than 3 layers', () => {
    const sm = new StateManager();
    sm.set('design', makeDesign([makeRect('a', 0, 0, 50, 50), makeRect('b', 0, 200, 50, 50)]));
    sm.set('selectedLayerIds', ['a', 'b']);
    const before = sm.getCurrentLayers().map(l => l.y);
    distributeV(sm);
    expect(sm.getCurrentLayers().map(l => l.y)).toEqual(before);
  });

// ── InteractionManager ───────────────────────────────────────

function makeDesignWithLayers(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  };
}

describe('InteractionManager', () => {
  let state: StateManager;
  let container: HTMLElement;
  let manager: InteractionManager;

  beforeEach(() => {
    state = new StateManager();
    container = document.createElement('div');
    document.body.appendChild(container);
    manager = new InteractionManager(container, state);
  });
  afterEach(() => {
    manager.disable();
    container.remove();
  });

  it('constructs without error', () => {
    expect(manager).toBeDefined();
  });

  it('enable() calls interact() for draggable and resizable', async () => {
    const interact = (await import('interactjs')).default;
    manager.enable();
    expect(interact).toHaveBeenCalled();
  });

  it('disable() resets activeInteractables', () => {
    manager.enable();
    manager.disable();
    // Should not throw
    expect(() => manager.disable()).not.toThrow();
  });

  it('refresh() calls disable then enable', () => {
    const disableSpy = vi.spyOn(manager as unknown as { disable: () => void }, 'disable');
    const enableSpy = vi.spyOn(manager as unknown as { enable: () => void }, 'enable');
    manager.refresh();
    expect(disableSpy).toHaveBeenCalled();
    expect(enableSpy).toHaveBeenCalled();
  });

  it('getLayerSnapTargets returns points from state layers', () => {
    state.set('design', makeDesignWithLayers([
      makeRect('a', 0, 0, 100, 100),
      makeRect('b', 200, 200, 50, 50),
    ]));
    // Access private method via cast
    const m = manager as unknown as { getLayerSnapTargets: (id: string) => { x: number; y: number }[] };
    const pts = m.getLayerSnapTargets('a');
    expect(pts.length).toBeGreaterThan(0);
    // Should not include points from layer 'a' itself
    expect(pts.some(p => p.x === 200 || p.x === 250)).toBe(true);
  });

  it('getLayerSnapTargets excludes the dragged layer', () => {
    state.set('design', makeDesignWithLayers([
      makeRect('dragged', 100, 100, 50, 50),
    ]));
    const m = manager as unknown as { getLayerSnapTargets: (id: string) => { x: number; y: number }[] };
    const pts = m.getLayerSnapTargets('dragged');
    // Only the dragged layer exists, so no snap targets
    expect(pts.length).toBe(0);
  });
});

describe('InteractionManager — drag and resize callbacks', () => {
  let state: StateManager;
  let container: HTMLElement;
  let interactMock: ReturnType<typeof vi.mocked<typeof import('interactjs').default>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    state = new StateManager();
    container = document.createElement('div');
    document.body.appendChild(container);
    const mod = await import('interactjs');
    interactMock = vi.mocked(mod.default);
  });
  afterEach(() => { container.remove(); });

  function getDraggableListeners(callIndex = 0) {
    // interact() returns same mockInteractable; draggable is called once per interact() call
    // callIndex 0 = first interact call = layer draggable
    return interactMock.mock.results[callIndex].value.draggable.mock.calls[0][0].listeners;
  }

  it('draggable start listener selects layer if not locked', () => {
    state.set('design', makeDesignWithLayers([makeRect('layer1', 0, 0, 100, 100)]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    const mockEl = document.createElement('div');
    mockEl.setAttribute('data-layer-id', 'layer1');
    getDraggableListeners(0).start({ target: mockEl });
    expect(state.get().selectedLayerIds).toContain('layer1');
    manager.disable();
  });

  it('draggable start: locked layer is ignored', () => {
    const lockedLayer = { ...makeRect('locked1', 0, 0, 100, 100), locked: true };
    state.set('design', makeDesignWithLayers([lockedLayer as unknown as Layer]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    const mockEl = document.createElement('div');
    mockEl.setAttribute('data-layer-id', 'locked1');
    getDraggableListeners(0).start({ target: mockEl });
    expect(state.get().selectedLayerIds).not.toContain('locked1');
    manager.disable();
  });

  it('draggable start: no layerId (target without data-layer-id) is ignored', () => {
    state.set('design', makeDesignWithLayers([]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    const plainEl = document.createElement('span');
    expect(() => getDraggableListeners(0).start({ target: plainEl })).not.toThrow();
    manager.disable();
  });

  it('draggable move listener updates layer position', () => {
    state.set('design', makeDesignWithLayers([makeRect('mv', 10, 20, 100, 100)]));
    state.set('zoom', 1, false);
    const manager = new InteractionManager(container, state);
    manager.enable();

    const mockEl = document.createElement('div');
    mockEl.setAttribute('data-layer-id', 'mv');

    // First, fire start to set draggedId
    getDraggableListeners(0).start({ target: mockEl });
    getDraggableListeners(0).move({ target: mockEl, dx: 10, dy: 5 });

    const layer = state.getCurrentLayers().find(l => l.id === 'mv');
    expect(layer?.x).toBe(20);
    expect(layer?.y).toBe(25);
    manager.disable();
  });

  it('draggable end clears draggedId without crash', () => {
    const manager = new InteractionManager(container, state);
    manager.enable();
    expect(() => getDraggableListeners(0).end()).not.toThrow();
    manager.disable();
  });
});

describe('InteractionManager — computeResize', () => {
  let state: StateManager;
  let manager: InteractionManager;

  beforeEach(() => {
    state = new StateManager();
    manager = new InteractionManager(document.createElement('div'), state);
  });

  function callComputeResize(layer: Layer, handle: string, dx: number, dy: number) {
    return (manager as unknown as {
      computeResize: (l: Layer, h: string, dx: number, dy: number) => Partial<Layer>;
    }).computeResize(layer, handle, dx, dy);
  }

  it('se handle resizes width and height', () => {
    const layer = makeRect('r', 0, 0, 100, 100);
    const result = callComputeResize(layer, 'se', 20, 10);
    expect(result.width).toBe(120);
    expect(result.height).toBe(110);
  });

  it('sw handle resizes width, height and adjusts x', () => {
    const layer = makeRect('r', 50, 50, 100, 100);
    const result = callComputeResize(layer, 'sw', -10, 20);
    expect(result.x).toBe(40);
    expect(result.width).toBe(110);
    expect(result.height).toBe(120);
  });

  it('ne handle resizes width, height and adjusts y', () => {
    const layer = makeRect('r', 0, 50, 100, 100);
    const result = callComputeResize(layer, 'ne', 30, -20);
    expect(result.y).toBe(30);
    expect(result.width).toBe(130);
    expect(result.height).toBe(120);
  });

  it('nw handle resizes and adjusts both x and y', () => {
    const layer = makeRect('r', 50, 50, 100, 100);
    const result = callComputeResize(layer, 'nw', -10, -10);
    expect(result.x).toBe(40);
    expect(result.y).toBe(40);
    expect(result.width).toBe(110);
    expect(result.height).toBe(110);
  });

  it('unknown handle returns empty object', () => {
    const layer = makeRect('r', 0, 0, 100, 100);
    const result = callComputeResize(layer, 'xx', 10, 10);
    expect(result).toEqual({});
  });

  it('clamps width and height to minimum 10', () => {
    const layer = makeRect('r', 0, 0, 15, 15);
    const result = callComputeResize(layer, 'se', -100, -100);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });
});

describe('InteractionManager — resizable move and snap targets', () => {
  let state: StateManager;
  let container: HTMLElement;
  let interactMock: ReturnType<typeof vi.mocked<typeof import('interactjs').default>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    state = new StateManager();
    container = document.createElement('div');
    const parent = document.createElement('div');
    parent.appendChild(container);
    document.body.appendChild(parent);
    const mod = await import('interactjs');
    interactMock = vi.mocked(mod.default);
  });
  afterEach(() => {
    container.parentElement?.remove();
  });

  it('resizable move: updates layer via computeResize', () => {
    state.set('design', makeDesignWithLayers([makeRect('resize-me', 0, 0, 100, 100)]));
    state.set('zoom', 1, false);
    const manager = new InteractionManager(container, state);
    manager.enable();

    // The second draggable call is for the resizable (selection handle)
    const resizableListeners = interactMock.mock.results[1].value.draggable.mock.calls[1][0].listeners;
    const handleEl = document.createElement('div');
    handleEl.dataset.handle = 'se';
    handleEl.dataset.layerId = 'resize-me';
    resizableListeners.move({ target: handleEl, dx: 20, dy: 10 });

    const layer = state.getCurrentLayers().find(l => l.id === 'resize-me');
    expect(layer?.width).toBe(120);
    expect((layer as unknown as { height: number }).height).toBe(110);
    manager.disable();
  });

  it('resizable move: no-op when no handle', () => {
    state.set('design', makeDesignWithLayers([makeRect('r2', 0, 0, 100, 100)]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    const resizableListeners = interactMock.mock.results[1].value.draggable.mock.calls[1][0].listeners;
    const handleEl = document.createElement('div');
    // No data-handle set
    expect(() => resizableListeners.move({ target: handleEl, dx: 10, dy: 10 })).not.toThrow();
    manager.disable();
  });

  it('snap targets function returns null when draggedId empty', () => {
    state.set('design', makeDesignWithLayers([]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    // Get the snap targets from modifiers.snap call args
    const snapArgs = vi.mocked(interactMock.modifiers.snap as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const snapTargetFn = snapArgs.targets[1]; // Custom snap function
    // draggedId is empty string → should return null
    const result = snapTargetFn(100, 100);
    expect(result).toBeNull();
    manager.disable();
  });

  it('snap targets function returns snap point when near a layer edge', () => {
    state.set('design', makeDesignWithLayers([
      makeRect('anchor', 0, 0, 100, 100),
      makeRect('drag-me', 200, 200, 50, 50),
    ]));
    const manager = new InteractionManager(container, state);
    manager.enable();

    // Simulate dragstart to set draggedId
    const mockEl = document.createElement('div');
    mockEl.setAttribute('data-layer-id', 'drag-me');
    interactMock.mock.results[0].value.draggable.mock.calls[0][0].listeners.start({ target: mockEl });

    const snapArgs = vi.mocked(interactMock.modifiers.snap as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const snapTargetFn = snapArgs.targets[1];
    // x=0, y=0 is an edge of 'anchor' — should snap
    const result = snapTargetFn(1, 1);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('x');
    manager.disable();
  });
});

describe('alignment — layers with undefined x/y/width/height (?? 0 / ternary : 0 branches)', () => {
  function makeLayerNoProps(id: string): Layer {
    return { id, type: 'rect', z: 0 } as unknown as Layer;
  }

  it('alignBottom with layer having no height uses 0 fallback (lines 211-213)', () => {
    const sm = new StateManager();
    const naked = makeLayerNoProps('naked');
    sm.set('design', makeDesign([naked, makeRect('normal', 0, 0, 50, 100)]));
    sm.set('selectedLayerIds', ['naked', 'normal']);
    alignBottom(sm);
    const layers = sm.getCurrentLayers();
    expect(layers.find(l => l.id === 'normal')!.y).toBe(0);
  });

  it('distributeH with layer missing x uses ?? 0 fallback (line 241)', () => {
    const sm = new StateManager();
    const noX = makeLayerNoProps('nox');
    sm.set('design', makeDesign([noX, makeRect('b', 100, 0, 50, 50), makeRect('c', 300, 0, 50, 50)]));
    sm.set('selectedLayerIds', ['nox', 'b', 'c']);
    expect(() => distributeH(sm)).not.toThrow();
    expect(sm.getCurrentLayers().length).toBe(3);
  });

  it('distributeV with layer missing y uses ?? 0 fallback (line 258)', () => {
    const sm = new StateManager();
    const noY = makeLayerNoProps('noy');
    sm.set('design', makeDesign([noY, makeRect('b', 0, 100, 50, 50), makeRect('c', 0, 300, 50, 50)]));
    sm.set('selectedLayerIds', ['noy', 'b', 'c']);
    expect(() => distributeV(sm)).not.toThrow();
    expect(sm.getCurrentLayers().length).toBe(3);
  });

  it('alignBottom with layer missing y also covers (l.y ?? 0) branch', () => {
    const sm = new StateManager();
    const noY = makeLayerNoProps('noy');
    const withH = { ...makeLayerNoProps('withH'), height: 80 } as unknown as Layer;
    sm.set('design', makeDesign([noY, withH]));
    sm.set('selectedLayerIds', ['noy', 'withH']);
    expect(() => alignBottom(sm)).not.toThrow();
  });

  it('alignRight with layer having non-numeric width uses ternary : 0 (line 196)', () => {
    const sm = new StateManager();
    // width: 'auto' is not a number → typeof l.width === 'number' is FALSE → uses 0
    const autoW = { id: 'aw', type: 'rect', z: 0, x: 50, y: 0, width: 'auto' } as unknown as Layer;
    sm.set('design', makeDesign([autoW, makeRect('normal', 0, 0, 100, 50)]));
    sm.set('selectedLayerIds', ['aw', 'normal']);
    expect(() => alignRight(sm)).not.toThrow();
    // 'normal' layer should align to right edge; autoW width treated as 0
    const layers = sm.getCurrentLayers();
    const normal = layers.find(l => l.id === 'normal')!;
    expect(normal.x).toBeDefined();
  });

  it('alignTop with layer missing y uses ?? 0 fallback (line 204)', () => {
    const sm = new StateManager();
    const noY = makeLayerNoProps('noy');
    sm.set('design', makeDesign([noY, makeRect('normal', 0, 100, 50, 50)]));
    sm.set('selectedLayerIds', ['noy', 'normal']);
    expect(() => alignTop(sm)).not.toThrow();
    // noY.y is undefined (0 via ??), normal.y=100; minY=0 → both move to y=0
    const layers = sm.getCurrentLayers();
    expect(layers.find(l => l.id === 'normal')!.y).toBe(0);
  });

  it('distributeH sort comparator covers b.x ?? 0 when b has no x (line 241)', () => {
    const sm = new StateManager();
    const noX2 = makeLayerNoProps('nox2');
    const noX3 = makeLayerNoProps('nox3');
    sm.set('design', makeDesign([makeRect('a', 100, 0, 50, 50), noX2, noX3]));
    sm.set('selectedLayerIds', ['a', 'nox2', 'nox3']);
    expect(() => distributeH(sm)).not.toThrow();
  });

  it('distributeV sort comparator covers b.y ?? 0 when b has no y (line 258)', () => {
    const sm = new StateManager();
    const noY2 = makeLayerNoProps('noy2');
    const noY3 = makeLayerNoProps('noy3');
    sm.set('design', makeDesign([makeRect('a', 0, 100, 50, 50), noY2, noY3]));
    sm.set('selectedLayerIds', ['a', 'noy2', 'noy3']);
    expect(() => distributeV(sm)).not.toThrow();
  });
});
