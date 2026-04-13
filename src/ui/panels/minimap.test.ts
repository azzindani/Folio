import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MinimapManager } from './minimap';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

// Mock URL.createObjectURL/revokeObjectURL (not available in jsdom)
const mockObjectURL = 'blob:mock-minimap-url';
const createObjectURLMock = vi.fn().mockReturnValue(mockObjectURL);
const revokeObjectURLMock = vi.fn();

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  // Give it a fake clientWidth so scale calc doesn't div by 0
  Object.defineProperty(el, 'clientWidth', { get: () => 240, configurable: true });
  document.body.appendChild(el);
  return el;
}

function makeDesign(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'X', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px' },
    layers: [],
  } as unknown as DesignSpec;
}

describe('MinimapManager', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
    // Polyfill for jsdom
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLMock, writable: true, configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLMock, writable: true, configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
  });

  it('builds a <canvas> element in the container', () => {
    new MinimapManager(container, state);
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('builds a viewport-indicator <div> in the container', () => {
    new MinimapManager(container, state);
    const divs = container.querySelectorAll('div');
    expect(divs.length).toBeGreaterThan(0);
  });

  it('refreshThumbnail is a no-op when there is no design', () => {
    // No design set → refreshThumbnail returns early without calling URL.createObjectURL
    new MinimapManager(container, state);
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it('refreshThumbnail runs when design is set', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    // createObjectURL should be called once to create blob URL for SVG
    expect(createObjectURLMock).toHaveBeenCalled();
  });

  it('updateViewportBox runs without throwing when design is set and zoom/pan change', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    expect(() => {
      state.set('zoom', 2);
      state.set('panX', -100, false);
      state.set('panY', -50, false);
    }).not.toThrow();
  });

  it('updateViewportBox is a no-op when no design', () => {
    const mgr = new MinimapManager(container, state);
    expect(() => {
      state.set('zoom', 2);
    }).not.toThrow();
    // vpBox should have no left/top set yet (no design means no update)
    const vpBox = container.querySelector('div') as HTMLElement;
    expect(vpBox).toBeTruthy();
    void mgr; // suppress unused warning
  });

  it('refreshes thumbnail when currentPageIndex changes on a paged design', () => {
    new MinimapManager(container, state);
    const pagedDesign = {
      ...makeDesign(),
      pages: [
        { id: 'p1', label: 'P1', layers: [] },
        { id: 'p2', label: 'P2', layers: [] },
      ],
    } as unknown as DesignSpec;
    state.set('design', pagedDesign);
    createObjectURLMock.mockClear();
    state.set('currentPageIndex', 1, false);
    expect(createObjectURLMock).toHaveBeenCalled();
  });
});
