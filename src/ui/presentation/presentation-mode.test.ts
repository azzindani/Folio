import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { PresentationMode } from './presentation-mode';
import type { DesignSpec } from '../../schema/types';

function makeDesign(layers = []): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers,
  } as unknown as DesignSpec;
}

function makePagedDesign(pageCount = 2): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test', name: 'Test', type: 'carousel', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `p${i}`, label: `Page ${i + 1}`, layers: [],
    })),
  } as unknown as DesignSpec;
}

describe('PresentationMode — open / close', () => {
  let state: StateManager;
  let pres: PresentationMode;

  beforeEach(() => {
    state = new StateManager();
    pres = new PresentationMode(state);
  });
  afterEach(() => {
    pres.close();
    // Clean up any leftover overlay
    document.body.querySelectorAll('.pres-overlay').forEach(el => el.remove());
  });

  it('open() with no design is a no-op', () => {
    pres.open();
    expect(document.body.querySelector('.pres-overlay')).toBeNull();
  });

  it('open() with design appends overlay to body', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    expect(document.body.querySelector('.pres-overlay')).not.toBeNull();
  });

  it('open() when already open does not create second overlay', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    pres.open(); // second call should be ignored
    const overlays = document.body.querySelectorAll('.pres-overlay');
    expect(overlays.length).toBe(1);
  });

  it('close() removes overlay from DOM', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    pres.close();
    expect(document.body.querySelector('.pres-overlay')).toBeNull();
  });

  it('close() when not open is safe', () => {
    expect(() => pres.close()).not.toThrow();
  });

  it('overlay contains pres-slide element', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    expect(document.body.querySelector('.pres-slide')).not.toBeNull();
  });

  it('overlay contains pres-hud element', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    expect(document.body.querySelector('.pres-hud')).not.toBeNull();
  });

  it('renders SVG in the slide container', () => {
    state.set('design', makeDesign(), false);
    pres.open();
    const slide = document.body.querySelector('.pres-slide');
    expect(slide?.querySelector('svg')).not.toBeNull();
  });
});

describe('PresentationMode — paged design navigation', () => {
  let state: StateManager;
  let pres: PresentationMode;

  beforeEach(() => {
    state = new StateManager();
    pres = new PresentationMode(state);
    state.set('design', makePagedDesign(3), false);
    state.set('currentPageIndex', 0, false);
    pres.open();
  });
  afterEach(() => {
    pres.close();
  });

  it('page counter shows page 1/3', () => {
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('1');
    expect(counter?.textContent).toContain('3');
  });

  it('ArrowRight advances page', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('2');
  });

  it('ArrowLeft wraps at first page (clamps to 0)', () => {
    // Already on page 0, ArrowLeft should do nothing
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('1');
  });

  it('ArrowDown advances page', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('2');
  });

  it('ArrowUp goes back a page (clamps at 0)', () => {
    // navigate forward first
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('1');
  });

  it('Space advances page', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('2');
  });

  it('Escape key closes the presentation', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.querySelector('.pres-overlay')).toBeNull();
  });

  it('next button advances page', () => {
    const hudBtns = document.body.querySelectorAll<HTMLButtonElement>('.pres-hud button');
    const nextBtn = hudBtns[1]; // prev=0, next=1, close=2
    nextBtn.click();
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('2');
  });

  it('prev button at page 0 does not go below 0', () => {
    const hudBtns = document.body.querySelectorAll<HTMLButtonElement>('.pres-hud button');
    const prevBtn = hudBtns[0];
    prevBtn.click();
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toContain('1');
  });

  it('close button closes the presentation', () => {
    const hudBtns = document.body.querySelectorAll<HTMLButtonElement>('.pres-hud button');
    const closeBtn = hudBtns[hudBtns.length - 1];
    closeBtn.click();
    expect(document.body.querySelector('.pres-overlay')).toBeNull();
  });
});

describe('PresentationMode — single-page design', () => {
  let state: StateManager;
  let pres: PresentationMode;

  beforeEach(() => {
    state = new StateManager();
    pres = new PresentationMode(state);
    state.set('design', makeDesign(), false);
    pres.open();
  });
  afterEach(() => { pres.close(); });

  it('counter is empty for single-page design', () => {
    const counter = document.body.querySelector('.pres-counter');
    expect(counter?.textContent).toBe('');
  });

  it('keydown on unhandled key does not crash', () => {
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    }).not.toThrow();
  });
});
