import { describe, it, expect, beforeEach } from 'vitest';
import { PageStrip } from './page-strip';
import { StateManager } from '../../editor/state';
import type { DesignSpec } from '../../schema/types';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function pagedDesign(pageCount: number): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'p', name: 'P', type: 'carousel', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px' },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `page_${i + 1}`,
      label: `Page ${i + 1}`,
      layers: [],
    })),
  } as unknown as DesignSpec;
}

describe('PageStrip', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
  });

  it('builds a .page-strip element inside container', () => {
    new PageStrip(container, state);
    expect(container.querySelector('.page-strip')).toBeTruthy();
  });

  it('hides strip when design has no pages', () => {
    const strip = new PageStrip(container, state);
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 'x', name: 'X', type: 'poster', created: '', modified: '' },
      document: { width: 800, height: 600, unit: 'px' },
      layers: [],
    } as unknown as DesignSpec);
    strip.render();
    const el = container.querySelector('.page-strip') as HTMLElement;
    expect(el.style.display).toBe('none');
  });

  it('shows thumbnails for each page', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(3));
    strip.render();
    // 3 page thumbs + 1 add button = 4 children
    const el = container.querySelector('.page-strip') as HTMLElement;
    expect(el.children.length).toBe(4);
  });

  it('first thumbnail is active (primary border)', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();
    const el = container.querySelector('.page-strip') as HTMLElement;
    const first = el.children[0] as HTMLElement;
    expect(first.style.border).toContain('var(--color-primary)');
  });

  it('clicking thumbnail updates currentPageIndex', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();
    const el = container.querySelector('.page-strip') as HTMLElement;
    const second = el.children[1] as HTMLElement;
    second.click();
    expect(state.get().currentPageIndex).toBe(1);
  });

  it('clicking "+" button adds a new page', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();
    const el = container.querySelector('.page-strip') as HTMLElement;
    const addBtn = el.children[el.children.length - 1] as HTMLElement;
    addBtn.click();
    expect(state.get().design?.pages?.length).toBe(3);
  });

  it('re-renders when currentPageIndex changes', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();
    state.set('currentPageIndex', 1, false);
    // After state change, second thumbnail should be active
    const el = container.querySelector('.page-strip') as HTMLElement;
    const second = el.children[1] as HTMLElement;
    expect(second.style.border).toContain('var(--color-primary)');
  });

  it('no-op when clicking add button without a design', () => {
    const strip = new PageStrip(container, state);
    strip.render();
    // Should not throw
    expect(() => strip.render()).not.toThrow();
  });
});
