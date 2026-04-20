import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV, distributeH, distributeV } from './interactions';
import type { Layer, DesignSpec } from '../schema/types';

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
