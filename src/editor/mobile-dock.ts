// Folio editor — the phone's bottom dock.
//
// THE RULE THIS ENFORCES: on a phone, everything you PRESS lives at the bottom.
// The top of a phone is where the thumb cannot reach and where the design
// should be; it had a 53px row of buttons (⋯, Play, Play all, undo, redo,
// Export) while the bottom carried a nav bar and a status bar that OVERLAPPED
// each other and ran off the right edge. This replaces all of it with one dock:
//
//   row 1 — [Visual | Payload | Preview] · undo · redo · play · export · more
//   row 2 — places: Layers · Props · Tools · Panels · Find
//
// The view switch is in the dock, not the More sheet: which view you are in is
// the one piece of state a phone user checks constantly, and two taps to reach
// the YAML was one too many. Fit and Present moved to More to make the room —
// on a phone, a pinch already fits.
//
// Nothing here re-implements a control. Each dock button dispatches a click on
// the real one (the toolbar's, the status bar's, the nav's), so behaviour cannot
// drift from the desktop's — the same delegation rule the popovers follow.
import { PHONE_LAYOUT_MQ } from './breakpoints';
import { chromeIcon } from './chrome-icons';

/** The three views, in the order the desktop toolbar shows them. */
const MODES: { mode: string; label: string; icon: string }[] = [
  { mode: 'visual', label: 'Visual', icon: 'image' },
  { mode: 'payload', label: 'Payload', icon: 'code' },
  { mode: 'preview', label: 'Preview', icon: 'eye' },
];

interface DockAction {
  key: string;
  /** Selector of the real control this fires. */
  sel: string;
  label: string;
  icon: string;
  /** Hide the dock button whenever its source control is hidden. */
  followsSource?: boolean;
}

const ACTIONS: DockAction[] = [
  { key: 'undo', sel: '[data-action="undo"]', label: 'Undo', icon: 'undo' },
  { key: 'redo', sel: '[data-action="redo"]', label: 'Redo', icon: 'redo' },
  { key: 'play', sel: '.toolbar-play', label: 'Play', icon: 'play', followsSource: true },
  { key: 'export', sel: '[data-action="export"]', label: 'Export', icon: 'upload' },
];

/** Controls that move into the More sheet, in the order they appear there.
 *  Not the mode switch: it stays home in the toolbar, where its delegated click
 *  handler lives, and the dock's own three buttons fire it. */
const MORE: string[] = [
  '[data-action="new-design"]',
  '[data-action="add-page"]',
  '.toolbar-catalog-btn',
  // The static server clones Catalog into a Library button AFTER the app boots
  // and re-inserts it next to Catalog if it ever goes missing — so once Catalog
  // lives in this sheet, Library arrives here on its own.
  '#folio-library-btn',
  '.toolbar-theme-select',
];

/** Status-bar controls the More sheet adopts, with the label a phone needs. */
const MORE_STATUS: { sel: string; label: string }[] = [
  { sel: '#zoom-fit', label: 'Fit to screen' },
  { sel: '#status-preview', label: 'Present' },
  { sel: '#toggle-grid', label: 'Grid' },
  { sel: '#toggle-snap', label: 'Snap' },
  { sel: '#canvas-resize', label: 'Resize canvas' },
  { sel: '#sb-ruler-unit', label: 'Ruler units' },
];

function actionMarkup(a: DockAction): string {
  // Labelled, like the nav row under it: a phone has no hover, so an unlabelled
  // icon row is a guessing game.
  return `<button class="dock-btn" type="button" data-dock="${a.key}" title="${a.label}" aria-label="${a.label}">
    <span class="dock-glyph">${chromeIcon(a.icon, 19)}</span><span class="dock-label">${a.label}</span>
  </button>`;
}

/** The view switch: three buttons in one group, so it reads as a switch and
 *  not as three more verbs. */
function modesMarkup(): string {
  return `<div class="dock-modes" role="group" aria-label="View">${MODES.map(m =>
    `<button class="dock-btn dock-mode" type="button" data-dock-mode="${m.mode}" title="${m.label}" aria-label="${m.label}" aria-pressed="false">
      <span class="dock-glyph">${chromeIcon(m.icon, 18)}</span><span class="dock-label">${m.label}</span>
    </button>`).join('')}</div>`;
}

/**
 * Build the dock and keep it in step with the controls it mirrors.
 *
 * Safe on every viewport: the dock markup is inert until the phone media query
 * matches (CSS), and the More sheet only adopts nodes while it does, handing
 * every one of them back when a rotation or a resize leaves phone width.
 */
export function wireMobileDock(container: HTMLElement): void {
  const nav = container.querySelector<HTMLElement>('.mobile-nav');
  if (!nav || container.querySelector('.mobile-dock')) return;

  const dock = document.createElement('div');
  dock.className = 'mobile-dock';
  dock.innerHTML = `
    <div class="dock-verbs">
      ${modesMarkup()}
      ${ACTIONS.map(actionMarkup).join('')}
      <button class="dock-btn" type="button" data-dock="more" title="More" aria-label="More">
        <span class="dock-glyph">${chromeIcon('more', 19)}</span><span class="dock-label">More</span>
      </button>
    </div>`;

  // The nav becomes the dock's second row rather than a separate fixed bar —
  // that separation is what let the two overlap at the bottom of the screen.
  nav.parentElement?.insertBefore(dock, nav);
  dock.appendChild(nav);

  const sheet = buildMoreSheet(container);
  wireActions(container, dock, sheet);
  followPlay(container, dock);
  followMode(container, dock);
}

/** Light the dock's view button for whichever mode the toolbar says is active. */
function followMode(container: HTMLElement, dock: HTMLElement): void {
  const toggle = container.querySelector<HTMLElement>('.mode-toggle');
  if (!toggle) return;
  const sync = (): void => {
    const active = toggle.querySelector<HTMLElement>('.mode-btn.active')?.dataset['mode'] ?? 'visual';
    dock.querySelectorAll<HTMLElement>('.dock-mode').forEach(b => {
      const on = b.dataset['dockMode'] === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  sync();
  new MutationObserver(sync).observe(toggle, { attributes: true, attributeFilter: ['class'], subtree: true });
}

function findSource(container: HTMLElement, sel: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(sel);
}

function wireActions(container: HTMLElement, dock: HTMLElement, sheet: HTMLElement): void {
  dock.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.dock-btn');
    // A view button fires the toolbar's own mode button — still in the toolbar,
    // unpainted, where ToolbarManager's delegated handler hears it.
    const mode = btn?.dataset['dockMode'];
    if (mode) {
      e.stopPropagation();
      // A new view is a new screen: whatever was open over the old one (the
      // More sheet, a Layers sheet, a popover) goes, or the YAML you just asked
      // for arrives underneath it. The backdrop's own click is the one "close
      // everything" every surface already listens to.
      container.querySelector<HTMLElement>('.mob-backdrop.active')?.click();
      findSource(container, `.mode-btn[data-mode="${mode}"]`)?.click();
      return;
    }
    const key = btn?.dataset['dock'];
    if (!key) return;
    // Any other verb dismisses the More sheet; it never stays open behind the
    // thing the verb opened (the Export sheet, the scene stage).
    if (key !== 'more' && sheet.classList.contains('open')) {
      sheet.classList.remove('open');
      container.querySelector('.mob-backdrop')?.classList.remove('active');
    }
    // The forwarded click is dispatched INSIDE this one, so both reach document
    // — and the toolbar's "close the export menu when you click outside it"
    // listener sees this outer event, whose target is a dock button, and shuts
    // the menu the forwarded click just opened. Tapping Export did nothing,
    // twice over. Stop here; the dock closes its own surfaces.
    e.stopPropagation();
    if (key === 'more') {
      sheet.classList.toggle('open');
      container.querySelector('.mob-backdrop')?.classList.toggle('active', sheet.classList.contains('open'));
      return;
    }
    const spec = ACTIONS.find(a => a.key === key);
    if (!spec) return;
    findSource(container, spec.sel)?.click();
  });
}

/** The Play button is hidden on a design with nothing to play — so is its dock twin. */
function followPlay(container: HTMLElement, dock: HTMLElement): void {
  const src = container.querySelector<HTMLElement>('.toolbar-play');
  const btn = dock.querySelector<HTMLElement>('[data-dock="play"]');
  if (!src || !btn) return;
  const sync = (): void => {
    btn.hidden = (src as HTMLButtonElement).hidden;
    const paused = src.innerHTML.includes('Pause');
    const glyph = btn.querySelector('.dock-glyph');
    const label = btn.querySelector('.dock-label');
    if (glyph) glyph.innerHTML = chromeIcon(paused ? 'pause' : 'play', 19);
    if (label) label.textContent = paused ? 'Pause' : 'Play';
  };
  sync();
  new MutationObserver(sync).observe(src, { attributes: true, childList: true, subtree: true });
}

/** The More sheet: the controls a phone needs occasionally, full-width and labelled. */
function buildMoreSheet(container: HTMLElement): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'dock-more';
  sheet.innerHTML = `<div class="dock-more-head"><span>More</span>
    <button class="dock-more-close" type="button" aria-label="Close">✕</button></div>
    <div class="dock-more-body"></div>`;
  // INSIDE the toolbar, not beside it. ToolbarManager delegates every click from
  // the .toolbar element, so a control moved outside it keeps its markup and
  // loses its behaviour — New, Add Page and Catalog sat there doing nothing. The
  // sheet is position:fixed, so living in the toolbar costs it no layout (the
  // tablet's ⋯ menu is mounted the same way for the same reason).
  (container.querySelector('.toolbar') ?? container).appendChild(sheet);
  const body = sheet.querySelector<HTMLElement>('.dock-more-body')!;

  const close = (): void => {
    sheet.classList.remove('open');
    container.querySelector('.mob-backdrop')?.classList.remove('active');
  };
  sheet.querySelector('.dock-more-close')?.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button:not(.dock-more-close)')) close(); });
  sheet.addEventListener('change', close);
  container.querySelector('.mob-backdrop')?.addEventListener('click', close);

  adoptControls(container, body);
  return sheet;
}

interface Moved { el: HTMLElement; marker: Comment; home: HTMLElement }

/**
 * Move the secondary controls into the sheet on a phone, and put every one of
 * them back when the viewport stops being one. A marker comment per control
 * restores the desktop order exactly; the nodes keep every binding they had,
 * because they are the SAME nodes.
 */
function adoptControls(container: HTMLElement, body: HTMLElement): void {
  const moved: Moved[] = [];
  const take = (sel: string, label?: string): void => {
    const el = container.querySelector<HTMLElement>(sel);
    const home = el?.parentElement;
    if (!el || !home) return;
    const marker = document.createComment('dock-more');
    home.insertBefore(marker, el);
    if (label) el.dataset['dockLabel'] = label;
    moved.push({ el, marker, home });
  };
  for (const sel of MORE) take(sel);
  for (const s of MORE_STATUS) take(s.sel, s.label);

  const mq = window.matchMedia(PHONE_LAYOUT_MQ);
  const apply = (): void => {
    if (mq.matches) {
      for (const m of moved) if (m.el.parentElement !== body) body.appendChild(m.el);
    } else {
      for (const m of moved) if (m.el.parentElement !== m.home) m.home.insertBefore(m.el, m.marker);
    }
  };
  apply();
  mq.addEventListener('change', apply);
}
