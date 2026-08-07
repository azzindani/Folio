import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireMobileSheets, wireMobileToolStrip, setDetent, detentOf } from './mobile-sheet';

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  app.className = 'app';
  app.innerHTML = `
    <div class="viewport-pane"></div>
    <div class="mob-backdrop"></div>
    <div class="left-panel">
      <div class="mob-sheet-grip"></div>
      <div class="left-panel-view" data-panel="layers"><div class="tools-panel"><button class="tool-btn" title="Select (V)"></button></div></div>
    </div>
    <div class="properties-panel"><div class="mob-sheet-grip"></div></div>
    <nav class="mobile-nav">
      <button class="mob-nav-btn" data-mob="layers"></button>
      <button class="mob-nav-btn" data-mob="props"></button>
      <button class="mob-nav-btn" data-mob="assets"></button>
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
  let onLayoutChange: ReturnType<typeof vi.fn<() => void>>;
  let openPalette: ReturnType<typeof vi.fn<() => void>>;
  let openAssets: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    app = makeApp();
    onLayoutChange = vi.fn();
    openPalette = vi.fn();
    openAssets = vi.fn();
    wireMobileSheets(app, { onLayoutChange, openPalette, openAssets });
  });

  const layersBtn = (): HTMLElement => app.querySelector<HTMLElement>('[data-mob="layers"]') as HTMLElement;
  const left = (): HTMLElement => app.querySelector<HTMLElement>('.left-panel') as HTMLElement;

  it('opens at the smallest detent so the canvas stays visible', () => {
    layersBtn().click();
    expect(left().classList.contains('mob-open')).toBe(true);
    expect(detentOf(left())).toBe('peek');
    expect(app.classList.contains('sheet-open')).toBe(true);
    expect(app.style.getPropertyValue('--sheet-h')).toBe('38vh');
    expect(app.classList.contains('sheet-dim')).toBe(false);
    expect(onLayoutChange).toHaveBeenCalled();
  });

  it('only dims the canvas at the tallest detent', () => {
    layersBtn().click();
    setDetent(app, left(), 'full');
    expect(app.classList.contains('sheet-dim')).toBe(true);
    setDetent(app, left(), 'half');
    expect(app.classList.contains('sheet-dim')).toBe(false);
    expect(app.style.getPropertyValue('--sheet-h')).toBe('60vh');
  });

  it('grows on an upward drag and shrinks on a downward one', () => {
    layersBtn().click();
    const g = grip(app, '.left-panel');
    pointer(g, 'pointerdown', 400); pointer(g, 'pointerup', 300);   // drag up
    expect(detentOf(left())).toBe('half');
    pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 400);   // drag down
    expect(detentOf(left())).toBe('peek');
  });

  it('closes when dragged down from the smallest detent', () => {
    layersBtn().click();
    const g = grip(app, '.left-panel');
    pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 400);
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });

  it('cycles heights on a tap', () => {
    layersBtn().click();
    const g = grip(app, '.left-panel');
    const tap = (): void => { pointer(g, 'pointerdown', 300); pointer(g, 'pointerup', 302); };
    tap(); expect(detentOf(left())).toBe('half');
    tap(); expect(detentOf(left())).toBe('full');
    tap(); expect(detentOf(left())).toBe('peek');
  });

  it('tapping the active nav button closes the sheet, and the backdrop closes it too', () => {
    layersBtn().click();
    layersBtn().click();
    expect(left().classList.contains('mob-open')).toBe(false);

    layersBtn().click();
    app.querySelector<HTMLElement>('.mob-backdrop')?.click();
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });

  it('opening one sheet closes the other', () => {
    layersBtn().click();
    app.querySelector<HTMLElement>('[data-mob="props"]')?.click();
    expect(left().classList.contains('mob-open')).toBe(false);
    expect(app.querySelector('.properties-panel')?.classList.contains('mob-open')).toBe(true);
  });

  it('opens the asset library in the left sheet — its only door on a phone', () => {
    app.querySelector<HTMLElement>('[data-mob="assets"]')?.click();
    expect(left().classList.contains('mob-open')).toBe(true);
    expect(detentOf(left())).toBe('peek');
    expect(openAssets).toHaveBeenCalledTimes(1);

    // Tapping it again closes, rather than re-opening the same view.
    app.querySelector<HTMLElement>('[data-mob="assets"]')?.click();
    expect(left().classList.contains('mob-open')).toBe(false);
  });

  it('routes the third button to the command palette without opening a sheet', () => {
    app.querySelector<HTMLElement>('[data-mob="cmd"]')?.click();
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(app.classList.contains('sheet-open')).toBe(false);
  });
});

describe('mobile tool strip', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('moves the palette out of the sheet on a phone and back on desktop', () => {
    const app = makeApp();
    const listeners: (() => void)[] = [];
    let matches = true;
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return matches; },
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    }));

    wireMobileToolStrip(app);
    expect(app.querySelector('.mob-toolstrip .tools-panel')).not.toBeNull();

    matches = false;
    listeners.forEach(fn => fn());
    expect(app.querySelector('.mob-toolstrip .tools-panel')).toBeNull();
    expect(app.querySelector('.left-panel-view .tools-panel')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
