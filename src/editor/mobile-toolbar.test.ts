import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wireMobileToolbarOverflow } from './mobile-toolbar';

/** Stubbed matchMedia we can flip between phone and desktop. */
function stubMQ(phone: boolean): { set: (v: boolean) => void } {
  let matches = phone;
  const listeners: (() => void)[] = [];
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return matches; },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  }));
  return { set: (v: boolean) => { matches = v; listeners.forEach(fn => fn()); } };
}

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  app.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left"><span class="toolbar-project-name">Untitled</span></div>
      <div class="toolbar-center">
        <button class="btn btn-sm" data-action="new-design"><span>New</span></button>
        <button class="btn btn-sm" data-action="add-page"><span>Add Page</span></button>
        <button class="btn btn-sm toolbar-catalog-btn" data-action="catalog"><span>Catalog</span></button>
        <div class="mode-toggle"><button class="mode-btn" data-mode="visual">Visual</button></div>
      </div>
      <div class="toolbar-right">
        <select class="toolbar-theme-select"><option value="a">A</option></select>
        <button class="btn btn-sm" data-action="undo">↩</button>
        <button class="btn btn-sm" data-action="redo">↪</button>
        <div class="export-group"><button data-action="export">Export</button></div>
      </div>
    </div>`;
  document.body.appendChild(app);
  return app;
}

const inMenu = (app: HTMLElement): string[] =>
  [...(app.querySelector('.toolbar-more-menu')?.children ?? [])]
    .map(e => (e as HTMLElement).dataset['action'] ?? e.className);

describe('mobile toolbar overflow', () => {
  let app: HTMLElement;
  beforeEach(() => { document.body.innerHTML = ''; app = makeApp(); });
  afterEach(() => vi.unstubAllGlobals());

  it('moves the secondary controls into the sheet on a phone', () => {
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    expect(inMenu(app)).toEqual(['mode-toggle', 'new-design', 'add-page', 'catalog', 'toolbar-theme-select']);
  });

  it('leaves undo, redo and Export in the strip — one row, no wrap', () => {
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    const right = app.querySelector('.toolbar-right');
    expect(right?.querySelector('[data-action="undo"]')).not.toBeNull();
    expect(right?.querySelector('[data-action="redo"]')).not.toBeNull();
    expect(right?.querySelector('.export-group')).not.toBeNull();
    // The mode switch moved: Visual|Payload|Preview is ~175px of a 390px screen
    // and is the difference between one row and two.
    expect(app.querySelector('.toolbar-center .mode-toggle')).toBeNull();
    expect(app.querySelector('.toolbar-more-menu .mode-toggle')).not.toBeNull();
  });

  it('keeps the menu inside .toolbar so click delegation still reaches it', () => {
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    // ToolbarManager listens on .toolbar; a menu outside it would silently
    // break New / Add Page / Catalog.
    expect(app.querySelector('.toolbar > .toolbar-more-menu')).not.toBeNull();
    const seen: string[] = [];
    app.querySelector('.toolbar')?.addEventListener('click', e => {
      seen.push((e.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action') ?? '');
    });
    app.querySelector<HTMLElement>('.toolbar-more-menu [data-action="add-page"]')?.click();
    expect(seen).toContain('add-page');
  });

  it('moves the SAME nodes, so their existing listeners survive', () => {
    const spy = vi.fn();
    app.querySelector('[data-action="catalog"]')?.addEventListener('click', spy);
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    app.querySelector<HTMLElement>('.toolbar-more-menu [data-action="catalog"]')?.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('toggles open on ⋯ and closes when something inside is picked', () => {
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    const menu = app.querySelector('.toolbar-more-menu');
    app.querySelector<HTMLElement>('.toolbar-more')?.click();
    expect(menu?.classList.contains('open')).toBe(true);
    app.querySelector<HTMLElement>('.toolbar-more-menu [data-action="new-design"]')?.click();
    expect(menu?.classList.contains('open')).toBe(false);
  });

  it('closes on a theme change and on an outside click', () => {
    stubMQ(true);
    wireMobileToolbarOverflow(app);
    const menu = app.querySelector('.toolbar-more-menu');
    app.querySelector<HTMLElement>('.toolbar-more')?.click();
    app.querySelector<HTMLElement>('.toolbar-theme-select')?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(menu?.classList.contains('open')).toBe(false);

    app.querySelector<HTMLElement>('.toolbar-more')?.click();
    document.body.click();
    expect(menu?.classList.contains('open')).toBe(false);
  });

  it('restores the desktop order exactly when the viewport grows', () => {
    const mq = stubMQ(true);
    wireMobileToolbarOverflow(app);
    mq.set(false);
    const centre = [...(app.querySelector('.toolbar-center')?.children ?? [])].map(e => (e as HTMLElement).dataset['action'] ?? e.className);
    expect(centre).toEqual(['new-design', 'add-page', 'catalog', 'mode-toggle']);
    expect(app.querySelector('.toolbar-center .mode-toggle')).not.toBeNull();
    // The select goes back ahead of undo, not appended at the end.
    const right = [...(app.querySelector('.toolbar-right')?.children ?? [])].map(e => (e as HTMLElement).dataset['action'] ?? e.className);
    expect(right[0]).toBe('btn btn-sm toolbar-more');
    expect(right[1]).toBe('toolbar-theme-select');
    expect(inMenu(app)).toEqual([]);
  });

  it('does nothing when the toolbar has not been built yet', () => {
    document.body.innerHTML = '';
    const empty = document.createElement('div');
    empty.innerHTML = '<div class="toolbar"></div>';
    document.body.appendChild(empty);
    stubMQ(true);
    wireMobileToolbarOverflow(empty);
    expect(empty.querySelector('.toolbar-more')).toBeNull();
  });
});
