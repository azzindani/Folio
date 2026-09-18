// The dock is the phone's ONE home for controls. These pin the three things
// that made the old chrome fail: a control must fire the real button (not a
// copy of its behaviour), a control moved into the More sheet must keep its
// bindings, and a click must not travel on to close what it just opened.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireMobileDock } from './mobile-dock';

function shell(): HTMLElement {
  const app = document.createElement('div');
  app.id = 'app';
  app.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-center">
        <div class="mode-toggle">
          <button class="mode-btn active" data-mode="visual">Visual</button>
          <button class="mode-btn" data-mode="payload">Payload</button>
          <button class="mode-btn" data-mode="preview">Preview</button>
        </div>
        <button data-action="new-design"><span>New</span></button>
        <button data-action="add-page"><span>Add Page</span></button>
        <button class="toolbar-catalog-btn"><span>Catalog</span></button>
      </div>
      <div class="toolbar-right">
        <select class="toolbar-theme-select"><option>Dark</option></select>
        <button class="btn toolbar-play" data-action="play" hidden>&#9654;<span>Play</span></button>
        <button data-action="undo">undo</button>
        <button data-action="redo">redo</button>
        <div class="export-group"><button data-action="export">Export</button></div>
      </div>
    </div>
    <div class="mob-backdrop"></div>
    <nav class="mobile-nav"><button class="mob-nav-btn" data-mob="layers">Layers</button></nav>
    <div class="status-bar">
      <button class="sb-btn" id="zoom-fit">fit</button>
      <button class="sb-btn" id="toggle-grid">grid</button>
      <button class="sb-btn" id="toggle-snap">snap</button>
      <button class="sb-btn" id="canvas-resize">resize</button>
      <span class="sb-ruler-unit" id="sb-ruler-unit">px</span>
      <button class="sb-btn" id="status-preview">present</button>
    </div>`;
  document.body.appendChild(app);
  return app;
}

/** matchMedia is not implemented in jsdom; the dock reads the phone query. */
function fakeMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches, media: query, onchange: null,
      addEventListener: () => { /* no listener needed for a fixed viewport */ },
      removeEventListener: () => { /* ditto */ },
      addListener: () => { /* legacy */ }, removeListener: () => { /* legacy */ },
      dispatchEvent: () => false,
    }),
  });
}

describe('mobile dock', () => {
  beforeEach(() => { document.body.innerHTML = ''; fakeMedia(true); });

  it('puts the nav inside the dock instead of leaving it a second fixed bar', () => {
    const app = shell();
    wireMobileDock(app);
    const dock = app.querySelector('.mobile-dock');
    expect(dock).toBeTruthy();
    expect(dock?.querySelector('.mobile-nav')).toBeTruthy();
  });

  it('labels every button — a phone has no hover to explain an icon', () => {
    const app = shell();
    wireMobileDock(app);
    const labels = [...app.querySelectorAll('.dock-verbs .dock-label')].map(n => n.textContent);
    expect(labels).toEqual(['Visual', 'Payload', 'Preview', 'Undo', 'Redo', 'Play', 'Export', 'More']);
  });

  it('puts the view switch in the dock, as one group', () => {
    const app = shell();
    wireMobileDock(app);
    const group = app.querySelector('.dock-verbs > .dock-modes');
    expect(group?.querySelectorAll('.dock-mode')).toHaveLength(3);
  });

  it('a view button fires the toolbar\'s own mode button, which stays home', () => {
    const app = shell();
    wireMobileDock(app);
    const real = app.querySelector<HTMLElement>('.mode-btn[data-mode="payload"]')!;
    const spy = vi.fn();
    real.addEventListener('click', spy);
    app.querySelector<HTMLElement>('[data-dock-mode="payload"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
    // Still inside the toolbar, where ToolbarManager's delegated handler lives.
    expect(real.closest('.toolbar-center')).toBeTruthy();
  });

  it('switching view closes whatever was open over the old one', () => {
    const app = shell();
    wireMobileDock(app);
    const closeAll = vi.fn();
    app.querySelector('.mob-backdrop')!.addEventListener('click', closeAll);
    app.querySelector<HTMLElement>('[data-dock="more"]')!.click();
    expect(app.querySelector('.dock-more')?.classList.contains('open')).toBe(true);
    app.querySelector<HTMLElement>('[data-dock-mode="payload"]')!.click();
    expect(app.querySelector('.dock-more')?.classList.contains('open')).toBe(false);
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it('any other verb dismisses the More sheet', () => {
    const app = shell();
    wireMobileDock(app);
    app.querySelector<HTMLElement>('[data-dock="more"]')!.click();
    app.querySelector<HTMLElement>('[data-dock="undo"]')!.click();
    expect(app.querySelector('.dock-more')?.classList.contains('open')).toBe(false);
  });

  it('lights whichever view the toolbar says is active', async () => {
    const app = shell();
    wireMobileDock(app);
    const pressed = (): string | undefined =>
      app.querySelector<HTMLElement>('.dock-mode.active')?.dataset['dockMode'];
    expect(pressed()).toBe('visual');
    app.querySelector('.mode-btn[data-mode="visual"]')!.classList.remove('active');
    app.querySelector('.mode-btn[data-mode="payload"]')!.classList.add('active');
    await Promise.resolve();   // MutationObserver callbacks are microtasks
    expect(pressed()).toBe('payload');
    expect(app.querySelector('[data-dock-mode="payload"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('fires the REAL control rather than re-implementing it', () => {
    const app = shell();
    wireMobileDock(app);
    const undo = app.querySelector<HTMLElement>('[data-action="undo"]')!;
    const spy = vi.fn();
    undo.addEventListener('click', spy);
    app.querySelector<HTMLElement>('[data-dock="undo"]')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('keeps its own click off document, so a forwarded open is not closed again', () => {
    const app = shell();
    wireMobileDock(app);
    const targets: string[] = [];
    const onDoc = (e: Event): void => {
      targets.push((e.target as HTMLElement).closest('.export-group') ? 'export-group' : 'elsewhere');
    };
    document.addEventListener('click', onDoc);
    app.querySelector<HTMLElement>('[data-dock="export"]')!.click();
    document.removeEventListener('click', onDoc);
    // Only the FORWARDED click surfaces, and it comes from inside .export-group
    // — which is what the toolbar's outside-click closer tests. The dock's own
    // click, whose target is a dock button, never gets there; when it did, the
    // closer shut the export sheet in the same tick that opened it.
    expect(targets).toEqual(['export-group']);
  });

  it('moves the secondary controls into the More sheet, nodes and all', () => {
    const app = shell();
    const add = app.querySelector('[data-action="add-page"]');
    wireMobileDock(app);
    const body = app.querySelector('.dock-more-body');
    expect(body?.contains(add!)).toBe(true);
    // The SAME node, so every binding the toolbar put on it still fires.
    expect(app.querySelectorAll('[data-action="add-page"]')).toHaveLength(1);
  });

  it('Fit and Present live in More, labelled, now the view switch has the room', () => {
    const app = shell();
    wireMobileDock(app);
    for (const [sel, label] of [['#zoom-fit', 'Fit to screen'], ['#status-preview', 'Present']] as const) {
      const el = app.querySelector<HTMLElement>(sel)!;
      expect(el.closest('.dock-more-body')).toBeTruthy();
      expect(el.dataset['dockLabel']).toBe(label);
    }
  });

  it('mounts the sheet inside the toolbar, where the toolbar delegate can hear it', () => {
    const app = shell();
    wireMobileDock(app);
    expect(app.querySelector('.toolbar > .dock-more')).toBeTruthy();
  });

  it('adopts the status-bar toggles with a readable label', () => {
    const app = shell();
    wireMobileDock(app);
    const grid = app.querySelector<HTMLElement>('#toggle-grid')!;
    expect(grid.closest('.dock-more-body')).toBeTruthy();
    expect(grid.dataset['dockLabel']).toBe('Grid');
  });

  it('leaves every control at home on a desktop', () => {
    fakeMedia(false);
    const app = shell();
    wireMobileDock(app);
    expect(app.querySelector('.toolbar-center > [data-action="new-design"]')).toBeTruthy();
    expect(app.querySelector('.dock-more-body')?.children.length).toBe(0);
  });

  it('hides its Play twin while the real Play button is hidden', () => {
    const app = shell();
    wireMobileDock(app);
    const btn = app.querySelector<HTMLButtonElement>('[data-dock="play"]')!;
    expect(btn.hidden).toBe(true);
  });

  it('is built once, however many times it is wired', () => {
    const app = shell();
    wireMobileDock(app);
    wireMobileDock(app);
    expect(app.querySelectorAll('.mobile-dock')).toHaveLength(1);
  });
});
