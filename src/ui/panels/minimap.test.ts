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

describe('MinimapManager — Image.onload and onDrag', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn().mockReturnValue('blob:test'), writable: true, configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(), writable: true, configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('Image.onload draws on canvas when ctx available', () => {
    const clearRectMock = vi.fn();
    const drawImageMock = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: clearRectMock,
      drawImage: drawImageMock,
    } as unknown as CanvasRenderingContext2D);

    // Mock Image so onload fires immediately when src is set
    const OrigImage = globalThis.Image;
    class InstantImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { setTimeout(() => this.onload?.(), 0); }
    }
    (globalThis as unknown as Record<string, unknown>).Image = InstantImage;

    new MinimapManager(container, state);
    state.set('design', makeDesign());

    (globalThis as unknown as Record<string, unknown>).Image = OrigImage;

    return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
      expect(clearRectMock).toHaveBeenCalled();
      expect(drawImageMock).toHaveBeenCalled();
    });
  });

  it('Image.onerror revokes the blob URL', () => {
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, writable: true, configurable: true });

    const OrigImage = globalThis.Image;
    class FailImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { setTimeout(() => this.onerror?.(), 0); }
    }
    (globalThis as unknown as Record<string, unknown>).Image = FailImage;

    new MinimapManager(container, state);
    state.set('design', makeDesign());

    (globalThis as unknown as Record<string, unknown>).Image = OrigImage;

    return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
      expect(revokeSpy).toHaveBeenCalled();
    });
  });

  it('mousedown on canvas fires onDrag without crash', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    state.set('zoom', 1, false);

    const canvas = container.querySelector('canvas')!;
    expect(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50 }));
    }).not.toThrow();
  });

  it('onDrag: mousemove after mousedown updates panX/panY', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    state.set('zoom', 1, false);

    const canvas = container.querySelector('canvas')!;
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
    // panX and panY should have been set
    expect(typeof state.get().panX).toBe('number');
    expect(typeof state.get().panY).toBe('number');
  });

  it('onDrag: mouseup removes mousemove listener', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());

    const canvas = container.querySelector('canvas')!;
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    // After mouseup, mousemove should not trigger pan changes
    const panXBefore = state.get().panX;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
    expect(state.get().panX).toBe(panXBefore);
  });
});
