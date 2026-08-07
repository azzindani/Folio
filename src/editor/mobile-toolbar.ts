// Folio editor — phone toolbar overflow.
//
// Everything in the toolbar matters, so nothing is dropped on a phone: it just
// wrapped to three rows and ate ~100px of canvas. The less-used half moves into
// a "⋯" sheet instead, leaving one row of what you touch constantly (mode
// switch, undo/redo, Export).
//
// The controls are MOVED, not re-created. ToolbarManager delegates clicks from
// the .toolbar element and holds a change listener on the theme <select>, so
// the menu lives inside .toolbar and the original nodes keep every binding they
// had. A marker node per control restores the desktop order exactly.

/** Controls that move into the sheet, in the order they appear there. */
const OVERFLOW = [
  '.mode-toggle',
  '[data-action="new-design"]',
  '[data-action="add-page"]',
  '.toolbar-catalog-btn',
  '.toolbar-theme-select',
];

interface Moved {
  el: HTMLElement;
  marker: Comment;
  home: HTMLElement;
}

/**
 * Collapse the secondary toolbar controls behind a ⋯ button under 768px.
 *
 * Safe to call once at startup: it tracks the media query itself and restores
 * the desktop layout when the viewport grows (a rotated tablet, a resized
 * window), so the phone path can never strand a control off-screen.
 */
export function wireMobileToolbarOverflow(container: HTMLElement): void {
  const toolbar = container.querySelector<HTMLElement>('.toolbar');
  if (!toolbar) return;

  const moved: Moved[] = [];
  for (const sel of OVERFLOW) {
    const el = toolbar.querySelector<HTMLElement>(sel);
    const home = el?.parentElement;
    if (!el || !home) continue;
    const marker = document.createComment('toolbar-overflow');
    home.insertBefore(marker, el);
    moved.push({ el, marker, home });
  }
  if (!moved.length) return;

  let btn = toolbar.querySelector<HTMLElement>('.toolbar-more');
  let menu = toolbar.querySelector<HTMLElement>('.toolbar-more-menu');
  if (!btn) {
    const b = document.createElement('button');
    b.type = 'button';
    btn = b;
    btn.className = 'btn btn-sm toolbar-more';
    btn.title = 'More';
    btn.setAttribute('aria-label', 'More toolbar controls');
    btn.textContent = '⋯';
    toolbar.querySelector('.toolbar-right')?.prepend(btn);
  }
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'toolbar-more-menu';
    toolbar.appendChild(menu);
  }

  const close = (): void => menu?.classList.remove('open');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('open');
  });
  // Picking anything inside dismisses the sheet — including the theme <select>,
  // whose change event fires before this click would land.
  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) close();
  });
  menu.addEventListener('change', close);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.toolbar-more-menu, .toolbar-more')) close();
  });

  // Tablets need this too: at 768px the toolbar wrapped to a second row and
  // spent 95px of a 1024px screen on chrome.
  const mq = window.matchMedia('(max-width: 1023px)');
  const apply = (): void => {
    if (mq.matches) {
      for (const m of moved) if (m.el.parentElement !== menu) menu?.appendChild(m.el);
    } else {
      close();
      for (const m of moved) if (m.el.parentElement !== m.home) m.home.insertBefore(m.el, m.marker);
    }
  };
  apply();
  mq.addEventListener('change', apply);
}
