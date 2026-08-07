// Folio editor — mobile bottom sheets.
//
// The panels used to open at a fixed 65vh, which on a phone buried the whole
// design: you tapped a layer and could not see what you had selected. Sheets
// now have three heights, start at the smallest, and the canvas viewport
// shrinks to whatever is left — so the selection stays on screen and "fit"
// means "fit in the part you can actually see".
export type SheetDetent = 'peek' | 'half' | 'full';

/** Heights per detent. `peek` deliberately leaves most of the canvas visible. */
const HEIGHT: Record<SheetDetent, string> = { peek: '38vh', half: '60vh', full: '86vh' };
const ORDER: SheetDetent[] = ['peek', 'half', 'full'];

const DETENT_CLASS = (d: SheetDetent): string => `mob-h-${d}`;

/** Read the detent a sheet is currently at (defaults to peek). */
export function detentOf(panel: HTMLElement): SheetDetent {
  return ORDER.find(d => panel.classList.contains(DETENT_CLASS(d))) ?? 'peek';
}

/** Apply a detent to a sheet and publish its height for the canvas to inset by. */
export function setDetent(container: HTMLElement, panel: HTMLElement, d: SheetDetent): void {
  for (const other of ORDER) panel.classList.remove(DETENT_CLASS(other));
  panel.classList.add(DETENT_CLASS(d));
  container.style.setProperty('--sheet-h', HEIGHT[d]);
  // Only the tallest detent dims the canvas; at peek/half you are meant to see
  // your design through the gap, which is the entire point of the small sizes.
  container.classList.toggle('sheet-dim', d === 'full');
}

/**
 * Keep the drawing tools reachable on a phone.
 *
 * The tool palette lives inside the left panel, which on mobile is a sheet — so
 * reaching Rectangle meant opening the sheet that covers the design you are
 * drawing on. On phones the palette is relocated into a persistent strip above
 * the nav bar, and put back when the viewport grows. A marker node holds its
 * place so the desktop layout is restored exactly, not appended to the end.
 */
export function wireMobileToolStrip(container: HTMLElement): void {
  const tools = container.querySelector<HTMLElement>('.tools-panel');
  const home = tools?.parentElement;
  if (!tools || !home) return;

  const marker = document.createComment('tools-panel-home');
  home.insertBefore(marker, tools);

  let strip = container.querySelector<HTMLElement>('.mob-toolstrip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'mob-toolstrip';
    container.appendChild(strip);
  }

  const mq = window.matchMedia('(max-width: 767px)');
  const apply = (): void => {
    if (mq.matches) {
      if (tools.parentElement !== strip) strip?.appendChild(tools);
    } else if (tools.parentElement !== home) {
      home.insertBefore(tools, marker);
    }
  };
  apply();
  mq.addEventListener('change', apply);
}

/** Never shrink the canvas below this — a 2px sliver is not "still visible". */
const MIN_CANVAS_PX = 140;

/**
 * Shrink the canvas pane by exactly how much the open sheet covers it.
 *
 * Doing this in CSS (`calc(100% - 38vh)`) looked right and was wrong: the pane
 * does not start at the top of the viewport and does not end at the sheet, so a
 * viewport-relative subtraction crushed it to a couple of pixels. Measuring the
 * real overlap is boring and exact.
 */
export function syncCanvasInset(container: HTMLElement): void {
  const pane = container.querySelector<HTMLElement>('.viewport-pane');
  if (!pane) return;
  pane.style.maxHeight = '';  // release the previous inset so we measure natural size
  const sheet = container.querySelector<HTMLElement>('.left-panel.mob-open, .properties-panel.mob-open');
  if (!sheet) return;
  const p = pane.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  const overlap = Math.max(0, p.bottom - s.top);
  if (overlap > 0) pane.style.maxHeight = `${Math.max(MIN_CANVAS_PX, Math.round(p.height - overlap))}px`;
}

export interface SheetOptions {
  /** Called after any change that resizes the canvas area (re-fit the design). */
  onLayoutChange: () => void;
  /** Command palette opener for the third nav button. */
  openPalette: () => void;
  /** Asset library opener — the activity bar that normally reaches it is
   *  hidden on phones, so the nav button is the only route. */
  openAssets?: () => void;
}

/**
 * Wire the mobile nav buttons, the backdrop and both sheet grips.
 *
 * Grip gestures: drag up grows a sheet, drag down shrinks it (and closes it
 * from the smallest size), a tap cycles through the heights. All three are
 * reachable one-handed, and none of them require hover.
 */
export function wireMobileSheets(container: HTMLElement, opts: SheetOptions): void {
  // Measure now for an instant response, and again once the height transition
  // has landed — the second pass is the one that gets the final geometry right.
  const relayout = (): void => {
    syncCanvasInset(container);
    window.setTimeout(() => syncCanvasInset(container), 280);
    opts.onLayoutChange();
  };
  const backdrop = container.querySelector<HTMLElement>('.mob-backdrop');
  const leftPanel = container.querySelector<HTMLElement>('.left-panel');
  const rightPanel = container.querySelector<HTMLElement>('.properties-panel');
  const navBtns = container.querySelectorAll<HTMLElement>('.mob-nav-btn');
  if (!backdrop || !leftPanel || !rightPanel) return;

  const closeAll = (): void => {
    for (const p of [leftPanel, rightPanel]) p.classList.remove('mob-open');
    backdrop.classList.remove('active');
    container.classList.remove('sheet-open', 'sheet-dim');
    navBtns.forEach(b => b.classList.remove('active'));
    relayout();
  };

  const open = (panel: HTMLElement, btn?: HTMLElement): void => {
    closeAll();
    panel.classList.add('mob-open');
    backdrop.classList.add('active');
    container.classList.add('sheet-open');
    setDetent(container, panel, 'peek');
    btn?.classList.add('active');
    relayout();
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset['mob'];
      if (target === 'cmd') { closeAll(); opts.openPalette(); return; }
      // Assets rides the LEFT sheet, switching it to the library view.
      if (target === 'assets') {
        const already = leftPanel.classList.contains('mob-open') && btn.classList.contains('active');
        if (already) { closeAll(); return; }
        open(leftPanel, btn);
        opts.openAssets?.();
        return;
      }
      const panel = target === 'layers' ? leftPanel : rightPanel;
      if (panel.classList.contains('mob-open')) { closeAll(); return; }
      open(panel, btn);
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
      relayout();
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
        relayout();
      }
    });
  }
}
