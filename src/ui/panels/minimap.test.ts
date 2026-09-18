import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MinimapManager } from './minimap';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

function makeContainer(width = 240): HTMLElement {
  const el = document.createElement('div');
  // Give it a fake clientWidth so the scale calculation has something to use.
  Object.defineProperty(el, 'clientWidth', { get: () => width, configurable: true });
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

const surface = (c: HTMLElement): HTMLElement => c.querySelector('.minimap-surface') as HTMLElement;
const thumb = (c: HTMLElement): SVGSVGElement | null => surface(c)?.querySelector('svg') ?? null;

describe('MinimapManager', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('builds a thumbnail surface and a viewport box in the container', () => {
    new MinimapManager(container, state);
    expect(surface(container)).toBeTruthy();
    expect(container.querySelectorAll('div').length).toBeGreaterThan(1);
  });

  it('draws nothing when there is no design', () => {
    new MinimapManager(container, state);
    expect(thumb(container)).toBeNull();
  });

  it('renders the design INLINE, so it shares the document\'s fonts', () => {
    // It used to serialise the SVG into a blob and draw it through an <img>.
    // SVG-as-image is sandboxed from the page's FontFace fonts, so every text
    // layer fell back to the default serif.
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    expect(thumb(container)).toBeTruthy();
    expect(container.querySelector('canvas, img')).toBeNull();
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
    new MinimapManager(container, state);
    expect(() => state.set('zoom', 2)).not.toThrow();
  });

  it('re-renders when the page changes on a paged design', () => {
    new MinimapManager(container, state);
    state.set('design', {
      ...makeDesign(),
      pages: [
        { id: 'p1', label: 'P1', layers: [] },
        { id: 'p2', label: 'P2', layers: [] },
      ],
    } as unknown as DesignSpec);
    const before = thumb(container);
    state.set('currentPageIndex', 1, false);
    expect(thumb(container)).toBeTruthy();
    expect(thumb(container)).not.toBe(before);
  });

  it('re-renders when a style overlay is picked, like the canvas and the strip do', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    const before = thumb(container);
    state.set('palette', { id: 'p', name: 'P', colors: {} } as unknown as Parameters<typeof state.set<'palette'>>[1], false);
    expect(thumb(container)).not.toBe(before);
  });

  it('tolerates a page with no layers property', () => {
    new MinimapManager(container, state);
    expect(() => state.set('design', {
      ...makeDesign(),
      pages: [{ id: 'p1', label: 'P1' }],
    } as unknown as DesignSpec)).not.toThrow();
  });
});

describe('MinimapManager — dragging', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
  });
  afterEach(() => container.remove());

  it('a drag pans the canvas', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    state.set('zoom', 1, false);
    surface(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(typeof state.get().panX).toBe('number');
    expect(typeof state.get().panY).toBe('number');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  it('centres the view on the point clicked, measured against the real canvas area', () => {
    // The click used to assume the canvas was 55% × 75% of the window, while
    // the viewport box was drawn from the measured area — so a click landed
    // the view somewhere the box did not show.
    const area = document.createElement('div');
    area.className = 'canvas-area';
    Object.defineProperty(area, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(area, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(area);
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    state.set('zoom', 1, false);
    // Clicking the thumbnail's top-left (0,0) puts design (0,0) at the centre.
    surface(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(state.get().panX).toBeCloseTo(400, 5);
    expect(state.get().panY).toBeCloseTo(300, 5);
    area.remove();
  });

  it('mouseup removes the mousemove listener', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    surface(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const panXBefore = state.get().panX;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
    expect(state.get().panX).toBe(panXBefore);
  });

  it('a mousemove with the design gone returns early', () => {
    new MinimapManager(container, state);
    state.set('design', makeDesign());
    surface(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    state.set('design', null as unknown as DesignSpec, false);
    expect(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
    }).not.toThrow();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
});

describe('MinimapManager — sizing before the panel is laid out', () => {
  const POSTER = {
    _protocol: 'design/v1',
    meta: { id: 'x', name: 'X', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1350, unit: 'px' },
    layers: [],
  } as unknown as DesignSpec;

  it('waits for a real width instead of guessing one', () => {
    // It used to fall back to 240px, then stretch the element to the panel's
    // real ~300px — so a portrait poster rendered nearly square. Deferring is
    // the fix: draw nothing until the width is known.
    const state = new StateManager();
    const c = makeContainer(0);
    new MinimapManager(c, state);
    expect(() => state.set('design', POSTER)).not.toThrow();
    expect(thumb(c)).toBeNull();
    expect(c.style.height).toBe('');
    c.remove();
  });

  it('keeps the design\'s aspect ratio once the width is measurable', () => {
    const state = new StateManager();
    const c = makeContainer(300);
    new MinimapManager(c, state);
    state.set('design', POSTER);
    const w = parseFloat(surface(c).style.width);
    const h = parseFloat(surface(c).style.height);
    expect(w / h).toBeCloseTo(1080 / 1350, 2);
    // The drawing and the box it sits in must be the same size, or it stretches.
    expect(thumb(c)?.getAttribute('width')).toBe(String(w));
    expect(thumb(c)?.getAttribute('height')).toBe(String(h));
    c.remove();
  });

  it('caps a tall design instead of letting it swallow the panel', () => {
    const state = new StateManager();
    const c = makeContainer(300);
    new MinimapManager(c, state);
    state.set('design', { ...POSTER, document: { width: 600, height: 3000, unit: 'px' } } as unknown as DesignSpec);
    const w = parseFloat(surface(c).style.width);
    const h = parseFloat(surface(c).style.height);
    expect(h).toBeLessThanOrEqual(260);
    expect(w / h).toBeCloseTo(600 / 3000, 2);
    c.remove();
  });
});
