// Folio editor — mobile bottom sheets.
//
// Two rules learned the hard way on a real phone:
//
// 1. A sheet NEVER resizes the canvas. The old build shrank the canvas pane by
//    the sheet's height and re-fit the design, so opening Layers dropped the
//    poster from 29% to 12% — you got a stamp of your design and a wall of UI.
//    Sheets now float over the canvas, translucent, and the canvas keeps every
//    pixel it had.
// 2. If the layer you just selected ends up behind the sheet, the canvas pans
//    up to bring it back into the visible band. Moving the view is cheap;
//    rescaling the design is not.
import { MobilePopover, collectPanelEntries, collectToolEntries } from './mobile-panels';

export type SheetDetent = 'peek' | 'half' | 'full';

/** Heights per detent. `peek` deliberately leaves most of the canvas visible. */
const HEIGHT: Record<SheetDetent, string> = { peek: '38vh', half: '60vh', full: '86vh' };
const ORDER: SheetDetent[] = ['peek', 'half', 'full'];

const DETENT_CLASS = (d: SheetDetent): string => `mob-h-${d}`;

/** Read the detent a sheet is currently at (defaults to peek). */
export function detentOf(panel: HTMLElement): SheetDetent {
  return ORDER.find(d => panel.classList.contains(DETENT_CLASS(d))) ?? 'peek';
}

/** Apply a detent to a sheet and publish its height for the sheet CSS. */
export function setDetent(container: HTMLElement, panel: HTMLElement, d: SheetDetent): void {
  for (const other of ORDER) panel.classList.remove(DETENT_CLASS(other));
  panel.classList.add(DETENT_CLASS(d));
  container.style.setProperty('--sheet-h', HEIGHT[d]);
  // Only the tallest detent dims the canvas; at peek/half you are meant to see
  // your design through the sheet, which is the entire point of the small sizes.
  container.classList.toggle('sheet-dim', d === 'full');
}

export interface SheetOptions {
  /** Command palette opener. */
  openPalette: () => void;
  /** Asset library opener — the panel is built lazily, so it needs its own hook
   *  rather than a plain click on the (not yet wired) activity-bar button. */
  openAssets?: () => void;
  /** Pan the canvas so the selection sits above `visibleBottom` (viewport px). */
  revealSelection?: (visibleBottom: number) => void;
}

/**
 * Wire the mobile nav, the popovers, the backdrop and both sheet grips.
 *
 * The nav is five fixed buttons — Layers, Properties, Tools, Panels, Search.
 * Everything else the desktop offers is behind Tools and Panels, which are
 * labelled grids generated from the desktop controls themselves (see
 * mobile-panels.ts), so nothing is reachable on a desktop and missing here.
 */
export function wireMobileSheets(container: HTMLElement, opts: SheetOptions): void {
  const backdrop = container.querySelector<HTMLElement>('.mob-backdrop');
  const leftPanel = container.querySelector<HTMLElement>('.left-panel');
  const rightPanel = container.querySelector<HTMLElement>('.properties-panel');
  const navBtns = container.querySelectorAll<HTMLElement>('.mob-nav-btn');
  if (!backdrop || !leftPanel || !rightPanel) return;

  const panelsPop = new MobilePopover(container, 'mob-pop-panels', 'Panels');
  const toolsPop = new MobilePopover(container, 'mob-pop-tools', 'Tools');

  /** Bring the selection back above an open sheet, without touching the zoom. */
  const reveal = (): void => {
    const sheet = container.querySelector<HTMLElement>('.left-panel.mob-open, .properties-panel.mob-open');
    if (sheet) opts.revealSelection?.(sheet.getBoundingClientRect().top);
  };

  const closeAll = (): void => {
    for (const p of [leftPanel, rightPanel]) p.classList.remove('mob-open');
    backdrop.classList.remove('active');
    container.classList.remove('sheet-open', 'sheet-dim');
    navBtns.forEach(b => b.classList.remove('active'));
    panelsPop.close();
    toolsPop.close();
  };

  const open = (panel: HTMLElement, btn?: HTMLElement): void => {
    for (const p of [leftPanel, rightPanel]) p.classList.remove('mob-open');
    navBtns.forEach(b => b.classList.remove('active'));
    panel.classList.add('mob-open');
    backdrop.classList.add('active');
    container.classList.add('sheet-open');
    setDetent(container, panel, 'peek');
    btn?.classList.add('active');
    panelsPop.close();
    toolsPop.close();
    // The sheet slides in; measure where it settled, not where it started.
    window.setTimeout(reveal, 300);
  };

  /** Show one of the desktop's left-panel views inside the left sheet. */
  const showLeftView = (panelId: string): void => {
    if (panelId === 'project-assets' && opts.openAssets) { open(leftPanel, navFor('layers')); opts.openAssets(); return; }
    open(leftPanel, navFor('layers'));
    container.querySelector<HTMLElement>(`.activity-bar .act-btn[data-panel="${panelId}"]`)?.click();
  };

  /** Show one of the desktop's right-panel tabs inside the right sheet. */
  const showRightTab = (tabId: string): void => {
    open(rightPanel, navFor('props'));
    container.querySelector<HTMLElement>(`.r-activity-bar .rpanel-tab[data-tab="${tabId}"]`)?.click();
  };

  function navFor(name: string): HTMLElement | undefined {
    return [...navBtns].find(b => b.dataset['mob'] === name);
  }

  const openPanelsPop = (): void => {
    if (panelsPop.isOpen) { panelsPop.close(); return; }
    toolsPop.close();
    panelsPop.open(collectPanelEntries(container), {
      isActive: e => e.source.classList.contains('active'),
      onPick: (e) => {
        const [kind, id] = e.key.split(':');
        if (kind === 'panel' && id) showLeftView(id);
        else if (kind === 'tab' && id) showRightTab(id);
        else e.source.click();  // theme toggle and anything else picked up later
      },
    });
  };

  const openToolsPop = (): void => {
    if (toolsPop.isOpen) { toolsPop.close(); return; }
    panelsPop.close();
    toolsPop.open(collectToolEntries(container), { isActive: e => e.source.classList.contains('active') });
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset['mob'];
      if (target === 'cmd') { closeAll(); opts.openPalette(); return; }
      if (target === 'panels') { openPanelsPop(); return; }
      if (target === 'tools') { openToolsPop(); return; }
      if (target === 'assets') { showLeftView('project-assets'); return; }
      const panel = target === 'layers' ? leftPanel : rightPanel;
      if (panel.classList.contains('mob-open')) { closeAll(); return; }
      if (target === 'layers') showLeftView('layers'); else open(panel, btn);
    });
  });

  backdrop.addEventListener('click', closeAll);

  for (const panel of [leftPanel, rightPanel]) {
    const grip = panel.querySelector<HTMLElement>('.mob-sheet-grip');
    if (!grip) continue;

    const step = (dir: 1 | -1): void => {
      const i = ORDER.indexOf(detentOf(panel));
      const next = i + dir;
      if (next < 0) { closeAll(); return; }
      setDetent(container, panel, ORDER[Math.min(next, ORDER.length - 1)] ?? 'full');
      window.setTimeout(reveal, 300);
    };

    let startY = 0;
    grip.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointerup', (e) => {
      const dy = e.clientY - startY;
      if (dy > 40) step(-1);
      else if (dy < -40) step(1);
      else {
        // A tap cycles: peek → half → full → peek, so one thumb can reach every
        // size without a precise drag.
        const i = ORDER.indexOf(detentOf(panel));
        setDetent(container, panel, ORDER[(i + 1) % ORDER.length] ?? 'peek');
        window.setTimeout(reveal, 300);
      }
    });
  }
}
