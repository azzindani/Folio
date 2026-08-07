import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobilePopover, collectPanelEntries, collectToolEntries } from './mobile-panels';

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  app.innerHTML = `
    <div class="activity-bar">
      <button class="act-btn active" data-panel="layers" title="Layers (⌘⇧L)"><svg id="i1"></svg></button>
      <button class="act-btn" data-panel="find" title="Find &amp; Replace (⌘H)"><svg></svg></button>
      <button class="act-btn" id="theme-toggle" title="Toggle light/dark theme"><svg></svg></button>
    </div>
    <div class="tools-panel">
      <button class="tool-btn active" data-tool="select" title="Select (V)"><svg></svg></button>
      <button class="tool-btn" data-tool="pen" title="Pen (P)"><svg></svg></button>
    </div>
    <div class="r-activity-bar">
      <button class="act-btn rpanel-tab" data-tab="colors" title="Colors" aria-label="Colors"><svg></svg></button>
    </div>`;
  document.body.appendChild(app);
  return app;
}

describe('mobile panel entries', () => {
  let app: HTMLElement;
  beforeEach(() => { document.body.innerHTML = ''; app = makeApp(); });

  it('mirrors the activity bar, the right tabs and the theme toggle', () => {
    const e = collectPanelEntries(app);
    expect(e.map(x => x.key)).toEqual(['panel:layers', 'panel:find', 'tab:colors', 'theme']);
    expect(e[0]?.label).toBe('Layers');           // shortcut hint dropped
    expect(e[1]?.label).toBe('Find & Replace');
  });

  it('carries each control\'s own icon markup, so the phone never invents one', () => {
    expect(collectPanelEntries(app)[0]?.icon).toContain('<svg id="i1">');
  });

  it('mirrors every drawing tool in palette order', () => {
    expect(collectToolEntries(app).map(x => x.key)).toEqual(['tool:select', 'tool:pen']);
    expect(collectToolEntries(app)[1]?.label).toBe('Pen');
  });

  it('a new panel added to the desktop shows up without touching this module', () => {
    const extra = document.createElement('button');
    extra.className = 'act-btn';
    extra.dataset['panel'] = 'shiny';
    extra.title = 'Shiny new thing';
    app.querySelector('.activity-bar')?.appendChild(extra);
    expect(collectPanelEntries(app).map(x => x.key)).toContain('panel:shiny');
  });
});

describe('MobilePopover', () => {
  let app: HTMLElement;
  beforeEach(() => { document.body.innerHTML = ''; app = makeApp(); });

  it('renders one labelled item per entry and marks the active one', () => {
    const pop = new MobilePopover(app, 'pop', 'Panels');
    pop.open(collectToolEntries(app), { isActive: e => e.source.classList.contains('active') });
    const items = app.querySelectorAll('#pop .mob-pop-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.classList.contains('active')).toBe(true);
    expect(items[1]?.textContent).toContain('Pen');
  });

  it('forwards a pick to the real control and closes', () => {
    const pen = app.querySelector<HTMLElement>('[data-tool="pen"]') as HTMLElement;
    const spy = vi.fn();
    pen.addEventListener('click', spy);
    const pop = new MobilePopover(app, 'pop', 'Tools');
    pop.open(collectToolEntries(app));
    app.querySelector<HTMLElement>('[data-key="tool:pen"]')?.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pop.isOpen).toBe(false);
  });

  it('runs onPick instead of the raw click when the caller needs to do more', () => {
    const pen = app.querySelector<HTMLElement>('[data-tool="pen"]') as HTMLElement;
    const raw = vi.fn();
    pen.addEventListener('click', raw);
    const onPick = vi.fn();
    const pop = new MobilePopover(app, 'pop', 'Tools');
    pop.open(collectToolEntries(app), { onPick, stayOpen: true });
    app.querySelector<HTMLElement>('[data-key="tool:pen"]')?.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(raw).not.toHaveBeenCalled();
    expect(pop.isOpen).toBe(true);
  });

  it('reuses one element per id and re-renders its contents', () => {
    const a = new MobilePopover(app, 'pop', 'Tools');
    a.open(collectToolEntries(app));
    const b = new MobilePopover(app, 'pop', 'Tools');
    b.open(collectPanelEntries(app));
    expect(app.querySelectorAll('#pop')).toHaveLength(1);
    expect(app.querySelectorAll('#pop .mob-pop-item')).toHaveLength(4);
  });

  it('toggles closed and reports its state', () => {
    const pop = new MobilePopover(app, 'pop', 'Tools');
    expect(pop.isOpen).toBe(false);
    pop.toggle(collectToolEntries(app));
    expect(pop.isOpen).toBe(true);
    pop.toggle(collectToolEntries(app));
    expect(pop.isOpen).toBe(false);
  });

  it('closes from its own ✕ button', () => {
    const pop = new MobilePopover(app, 'pop', 'Tools');
    pop.open(collectToolEntries(app));
    app.querySelector<HTMLElement>('#pop .mob-pop-close')?.click();
    expect(pop.isOpen).toBe(false);
  });
});
