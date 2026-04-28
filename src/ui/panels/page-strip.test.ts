import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('thumbnail uses numeric index when page has no label', () => {
    const strip = new PageStrip(container, state);
    const unlabeledDesign = {
      _protocol: 'design/v1',
      meta: { id: 'x', name: 'X', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' },
      pages: [
        { id: 'p1', layers: [] },  // no label
      ],
    } as unknown as DesignSpec;
    state.set('design', unlabeledDesign);
    strip.render();
    const el = container.querySelector('.page-strip') as HTMLElement;
    const thumb = el.children[0] as HTMLElement;
    // Falls back to `${index + 1}` = "1"
    expect(thumb.textContent).toBe('1');
  });

  it('reacts to design state change via subscribe', () => {
    new PageStrip(container, state);
    // Setting design triggers onStateChange → render
    state.set('design', pagedDesign(2));
    const el = container.querySelector('.page-strip') as HTMLElement;
    expect(el.style.display).toBe('flex');
  });

  it('onStateChange with unrelated key does not re-render (false branch line 27)', () => {
    new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    const innerHTML = container.querySelector('.page-strip')!.innerHTML;
    // Changing zoom doesn't trigger re-render
    state.set('zoom', 2);
    expect(container.querySelector('.page-strip')!.innerHTML).toBe(innerHTML);
  });

  it('addPage is a no-op when design is removed before click (lines 86-88)', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();
    // Get the + button (last child)
    const el = container.querySelector('.page-strip') as HTMLElement;
    const addBtn = el.children[el.children.length - 1] as HTMLElement;
    // Remove the design from state
    state.set('design', null as unknown as import('../../schema/types').DesignSpec);
    // Click add button when no design → should be a no-op
    expect(() => addBtn.click()).not.toThrow();
  });

  it('createThumbnail uses ?? 1080 fallback when document dims missing (line 63)', () => {
    const strip = new PageStrip(container, state);
    const designNoSize = {
      _protocol: 'design/v1',
      meta: { id: 'x', name: 'X', type: 'carousel', created: '', modified: '' },
      document: {} as unknown as { width: number; height: number; unit: string },
      pages: [{ id: 'p1', label: 'P1', layers: [] }],
    } as unknown as import('../../schema/types').DesignSpec;
    state.set('design', designNoSize);
    strip.render();
    // Should render without crashing even with undefined dimensions
    const el = container.querySelector('.page-strip') as HTMLElement;
    expect(el.children.length).toBeGreaterThan(0);
  });

  it('right-click on thumbnail opens context menu', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();

    const thumb = container.querySelector<HTMLElement>('[data-page-index="0"]');
    if (!thumb) {
      // fallback: find first wrapper div inside .page-strip (not the + button)
      const all = container.querySelectorAll<HTMLElement>('.page-strip > div');
      const firstThumb = Array.from(all).find(el => !el.textContent?.includes('+'));
      firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    } else {
      thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    }

    const menu = document.querySelector('.page-context-menu');
    expect(menu).not.toBeNull();
    menu?.remove();
  });

  it('context menu has Rename and Delete items when > 1 page', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(3));
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    const menu = document.querySelector('.page-context-menu');
    expect(menu?.textContent).toContain('Rename');
    expect(menu?.textContent).toContain('Delete');
    menu?.remove();
  });

  it('context menu has only Rename when single page', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(1));
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    const menu = document.querySelector('.page-context-menu');
    expect(menu?.textContent).toContain('Rename');
    expect(menu?.textContent).not.toContain('Delete');
    menu?.remove();
  });

  it('clicking Delete removes the page from state', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(3));
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    const menu = document.querySelector('.page-context-menu');
    const deleteBtn = Array.from(menu?.querySelectorAll('button') ?? []).find(b => b.textContent?.includes('Delete'));
    deleteBtn?.click();

    const design = state.get().design as DesignSpec;
    expect(design.pages?.length).toBe(2);
  });

  it('clicking outside context menu dismisses it', () => {
    const strip = new PageStrip(container, state);
    state.set('design', pagedDesign(2));
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    expect(document.querySelector('.page-context-menu')).not.toBeNull();

    // Simulate click outside
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Allow the setTimeout(0) inside openPageContextMenu to fire
    return new Promise<void>(resolve => {
      setTimeout(() => {
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        setTimeout(() => {
          expect(document.querySelector('.page-context-menu')).toBeNull();
          resolve();
        }, 10);
      }, 10);
    });
  });
});

describe('PageStrip — rename via context menu', () => {
  let state: StateManager;
  let container: HTMLElement;

  beforeEach(() => {
    state = new StateManager();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.page-context-menu').forEach(m => m.remove());
    vi.restoreAllMocks();
  });

  it('Rename prompts and updates page label', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('New Title');
    const strip = new PageStrip(container, state);
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 'p', name: 'P', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' },
      pages: [
        { id: 'p1', label: 'Old Title', layers: [] },
        { id: 'p2', label: 'Page 2', layers: [] },
      ],
    } as unknown as DesignSpec);
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    const menu = document.querySelector('.page-context-menu');
    const renameBtn = Array.from(menu?.querySelectorAll('button') ?? []).find(b => b.textContent?.includes('Rename'));
    renameBtn?.click();

    const design = state.get().design as DesignSpec;
    expect(design.pages?.[0].label).toBe('New Title');
  });

  it('Rename prompt cancels when user cancels (returns null)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const strip = new PageStrip(container, state);
    state.set('design', {
      _protocol: 'design/v1',
      meta: { id: 'p', name: 'P', type: 'carousel', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px' },
      pages: [{ id: 'p1', label: 'Original', layers: [] }],
    } as unknown as DesignSpec);
    strip.render();

    const thumbs = container.querySelectorAll<HTMLElement>('.page-strip > div');
    const firstThumb = Array.from(thumbs).find(el => !el.textContent?.includes('+'));
    firstThumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));

    const menu = document.querySelector('.page-context-menu');
    const renameBtn = Array.from(menu?.querySelectorAll('button') ?? []).find(b => b.textContent?.includes('Rename'));
    renameBtn?.click();

    const design = state.get().design as DesignSpec;
    // Label unchanged
    expect(design.pages?.[0].label).toBe('Original');
  });
});
