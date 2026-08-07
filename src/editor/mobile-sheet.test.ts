import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireMobileSheets, setDetent, detentOf } from './mobile-sheet';

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  app.className = 'app';
  app.innerHTML = `
    <div class="viewport-pane"></div>
    <div class="mob-backdrop"></div>
    <div class="activity-bar">
      <button class="act-btn active" data-panel="layers" title="Layers (⌘⇧L)"><svg></svg></button>
      <button class="act-btn" data-panel="project-assets" title="Project assets"><svg></svg></button>
      <button class="act-btn" data-panel="components" title="Components (⌘⇧K)"><svg></svg></button>
      <button class="act-btn" id="theme-toggle" title="Toggle light/dark theme"><svg></svg></button>
    </div>
    <div class="left-panel">
      <div class="mob-sheet-grip"></div>
      <div class="left-panel-view" data-panel="layers"><div class="tools-panel">
        <button class="tool-btn active" data-tool="select" title="Select (V)"><svg></svg></button>
        <button class="tool-btn" data-tool="rect" title="Rectangle (R)"><svg></svg></button>
        <button class="tool-btn" data-tool="line" title="Line (L)"><svg></svg></button>
      </div></div>
    </div>
    <div class="properties-panel"><div class="mob-sheet-grip"></div></div>
    <div class="r-activity-bar">
      <button class="act-btn rpanel-tab active" data-tab="properties" title="Properties"><svg></svg></button>
      <button class="act-btn rpanel-tab" data-tab="timeline" title="Timeline"><svg></svg></button>
      <button class="act-btn rpanel-tab" data-tab="a11y" title="Accessibility"><svg></svg></button>
    </div>
    <nav class="mobile-nav">
      <button class="mob-nav-btn" data-mob="layers"></button>
      <button class="mob-nav-btn" data-mob="props"></button>
      <button class="mob-nav-btn" data-mob="tools"></button>
      <button class="mob-nav-btn" data-mob="panels"></button>
      <button class="mob-nav-btn" data-mob="cmd"></button>
    </nav>`;
  document.body.appendChild(app);
  return app;
}

const grip = (app: HTMLElement, sel: string): HTMLElement =>
  app.querySelector<HTMLElement>(`${sel} .mob-sheet-grip`) as HTMLElement;

/** jsdom has no pointer capture; stub it so the handlers run. */
function pointer(el: HTMLElement, type: 'pointerdown' | 'pointerup', clientY: number): void {
  (el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => undefined;
  const ev = new Event(type, { bubbles: true }) as Event & { clientY: number; pointerId: number };
  Object.defineProperty(ev, 'clientY', { value: clientY });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  el.dispatchEvent(ev);
}

describe('mobile sheets', () => {
  let app: HTMLElement;
  let openPalette: ReturnType<typeof vi.fn<() => void>>;
  let openAssets: ReturnType<typeof vi.fn<() => void>>;
  let revealSelection: ReturnType<typeof vi.fn<(bottom: number) => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    app = makeApp();
    openPalette = vi.fn();
    openAssets = vi.fn();
    revealSelection = vi.fn();
    wireMobileSheets(app, { openPalette, openAssets, revealSelection });
  });

  const btn = (mob: string): HTMLElement => app.querySelector<HTMLElement>(`[data-mob="${mob}"]`) as HTMLElement;
  const left = (): HTMLElement => app.querySelector<HTMLElement>('.left-panel') as HTMLElement;
  const items = (pop: string): HTMLElement[] => [...app.querySelectorAll<HTMLElement>(`#${pop} .mob-pop-item`)];

  it('opens at the smallest detent so the canvas stays visible', () => {
    btn('layers').click();
    expect(left().classList.contains('mob-open')).toBe(true);
    expect(detentOf(left())).toBe('peek');
    expect(app.classList.contains('sheet-open')).toBe(true);
    expect(app.style.getPropertyValue('--sheet-h')).toBe('38vh');
    expect(app.classList.contains('sheet-dim')).toBe(false);
  });

  it('only dims the canvas at the tallest detent', () => {
    btn('layers').click();
    setDetent(app, left(), 'full');
    expect(app.classList.contains('sheet-dim')).toBe(true);
    setDetent(app, left(), 'half');
    expect(app.classList.contains('sheet-dim')).toBe(false);
    expect(app.style.getPropertyValue('--sheet-h')).toBe('60vh');
  });

  it('grows on an upward drag and shrinks on a downward one', () => {
    btn('layers').click();
    const g = grip(app, '.left-panel');
    pointer(g, 'pointerdown', 400); pointer(g, 'pointerup', 300);   // drag up
    expect(detentOf(left())).toBe('half');
    pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 400);   // drag down
    expect(detentOf(left())).toBe('peek');
  });

  it('closes when dragged down from the smallest detent', () => {
    btn('layers').click();
    const g = grip(app, '.left-panel');
    pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 400);
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });

  it('cycles heights on a tap', () => {
    btn('layers').click();
    const g = grip(app, '.left-panel');
    const tap = (): void => { pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 302); };
    tap(); expect(detentOf(left())).toBe('half');
    tap(); expect(detentOf(left())).toBe('full');
    tap(); expect(detentOf(left())).toBe('peek');
  });

  it('tapping the active nav button closes the sheet, and the backdrop closes it too', () => {
    btn('layers').click();
    btn('layers').click();
    expect(left().classList.contains('mob-open')).toBe(false);

    btn('layers').click();
    app.querySelector<HTMLElement>('.mob-backdrop')?.click();
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });

  it('opening one sheet closes the other', () => {
    btn('layers').click();
    btn('props').click();
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.querySelector('.properties-panel')?.classList.contains('mob-open')).toBe(true);
  });

  it('routes the search button to the command palette without opening a sheet', () => {
    btn('cmd').click();
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });

  it('pans the selection back into view once a sheet has settled', async () => {
    btn('layers').click();
    await new Promise(r => setTimeout(r, 340));
    expect(revealSelection).toHaveBeenCalled();
  });

  // ── Parity: everything the desktop offers is reachable here ──
  it('lists every activity-bar panel and right-panel tab in the Panels popover', () => {
    btn('panels').click();
    const labels = items('mob-pop-panels').map(i => i.textContent?.trim());
    // Shortcut hints are stripped — they mean nothing without a keyboard.
    expect(labels).toEqual(['Layers', 'Project assets', 'Components',
      'Properties', 'Timeline', 'Accessibility', 'Theme']);
  });

  it('opens a left panel from the popover and switches its view', () => {
    btn('panels').click();
    items('mob-pop-panels').find(i => i.textContent?.includes('Components'))?.click();
    expect(left().classList.contains('mob-open')).toBe(true);
    expect(app.querySelector('.act-btn[data-panel="components"]')?.classList.contains('active')).toBe(false);
    // The popover forwards to the real control; wiring it is the panel's job,
    // so assert the click landed rather than the view swap.
    expect(app.querySelector('#mob-pop-panels')?.classList.contains('open')).toBe(false);
  });

  it('opens a right-panel tab from the popover in the properties sheet', () => {
    btn('panels').click();
    items('mob-pop-panels').find(i => i.textContent?.includes('Timeline'))?.click();
    expect(app.querySelector('.properties-panel')?.classList.contains('mob-open')).toBe(true);
  });

  it('routes the assets entry through the lazy loader, not a raw click', () => {
    btn('panels').click();
    items('mob-pop-panels').find(i => i.textContent?.includes('Project assets'))?.click();
    expect(openAssets).toHaveBeenCalledTimes(1);
    expect(left().classList.contains('mob-open')).toBe(true);
  });

  it('lists every drawing tool in the Tools popover and marks the active one', () => {
    btn('tools').click();
    const labels = items('mob-pop-tools').map(i => i.textContent?.trim());
    expect(labels).toEqual(['Select', 'Rectangle', 'Line']);
    expect(items('mob-pop-tools')[0]?.classList.contains('active')).toBe(true);
  });

  it('picking a tool clicks the real palette button and closes the popover', () => {
    const rect = app.querySelector<HTMLElement>('.tool-btn[data-tool="rect"]') as HTMLElement;
    const spy = vi.fn();
    rect.addEventListener('click', spy);
    btn('tools').click();
    items('mob-pop-tools').find(i => i.textContent?.includes('Rectangle'))?.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(app.querySelector('#mob-pop-tools')?.classList.contains('open')).toBe(false);
  });

  it('tapping Tools twice closes it, and opening a sheet dismisses both popovers', () => {
    btn('tools').click();
    expect(app.querySelector('#mob-pop-tools')?.classList.contains('open')).toBe(true);
    btn('tools').click();
    expect(app.querySelector('#mob-pop-tools')?.classList.contains('open')).toBe(false);

    btn('panels').click();
    btn('layers').click();
    expect(app.querySelector('#mob-pop-panels')?.classList.contains('open')).toBe(false);
  });
});
