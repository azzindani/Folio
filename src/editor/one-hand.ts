// Folio editor — one-handed reach layer for phones.
//
// THE PROBLEM. Held in one hand, a phone is operated by a thumb pivoting near
// the bottom corner on the holding side. Its comfortable sweep is a quarter
// annulus roughly 45–65% of the screen height in radius. The top bar sits
// outside it: reaching Undo or Export means regripping the phone, which on a
// design tool you are doing constantly.
//
// THE DETERMINATIONS.
//  1. Nothing may live ONLY in the top bar. Every toolbar action gets a second
//     home inside the thumb sweep. Nothing is removed from the top — a second
//     route, not a relocation.
//  2. Not another bottom bar. The bottom edge already carries the nav, and the
//     very bottom corner is where the thumb PIVOTS, not where it rests. The
//     comfortable zone is the MIDDLE band of the screen, so that is where the
//     actions go — along an arc swept from the anchor.
//  3. One anchor, draggable, remembered. It defaults to the right edge at 55%
//     height. Drag it anywhere; it snaps to the nearer side and the arc mirrors,
//     which is the whole left-handed story. Position persists.
//  4. Zero layout cost. The anchor and arc float above the canvas: no grid
//     column, no inset, no refit. The design never shrinks to make room.
//  5. It yields. While a sheet or the command palette is open, the anchor
//     hides rather than floating over the thing you just opened.
//  6. It delegates. Every action re-dispatches a click on the REAL control, so
//     behaviour cannot drift from the toolbar it mirrors.
//
// Loaded only on a coarse pointer.

const STORE_KEY = 'folio.oneHand.pos';
const FAB = 52;
const ITEM = 48;
// Geometry, not taste: adjacent centres must clear ITEM + a gap, and the chord
// between two items on the arc is 2·r·sin(Δθ/2). With six items over 150° at
// r=124 that chord is ~64px, so nothing overlaps. Shrink either number and the
// targets start touching, which is how the first pass looked.
const RADIUS = 124;
const SPREAD_DEG = 150;

interface ActionSpec {
  /** Selector of the real control this mirrors. */
  sel: string;
  label: string;
  glyph: string;
}

// Ordered nearest-thumb first: the arc's middle is the easiest reach, so the
// two most-used (undo/redo) sit there rather than at the ends.
const ACTIONS: ActionSpec[] = [
  { sel: '.mob-nav-btn[data-mob="panels"]', label: 'Panels', glyph: '▤' },
  { sel: '[data-action="undo"]', label: 'Undo', glyph: '↶' },
  { sel: '[data-action="redo"]', label: 'Redo', glyph: '↷' },
  { sel: '.mob-nav-btn[data-mob="tools"]', label: 'Tools', glyph: '✎' },
  { sel: '.mob-nav-btn[data-mob="cmd"]', label: 'Find', glyph: '⌕' },
  { sel: '.export-group button, [data-action="export"]', label: 'Export', glyph: '↥' },
];

interface Pos { x: number; y: number }

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    return typeof p?.x === 'number' && typeof p?.y === 'number' ? p : null;
  } catch { return null; }
}
function savePos(p: Pos): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Default: right edge, 55% down — the middle band, not the bottom corner. */
function defaultPos(): Pos {
  return { x: window.innerWidth - FAB - 10, y: Math.round(window.innerHeight * 0.55) };
}

export function wireOneHand(root: HTMLElement): (() => void) | null {
  if (root.querySelector('.oh-fab')) return null;

  const fab = document.createElement('button');
  fab.className = 'oh-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Quick actions');
  fab.setAttribute('aria-expanded', 'false');
  fab.textContent = '✦';

  const arc = document.createElement('div');
  arc.className = 'oh-arc';
  arc.setAttribute('role', 'menu');

  const buttons: HTMLButtonElement[] = ACTIONS.map(a => {
    const b = document.createElement('button');
    b.className = 'oh-item';
    b.type = 'button';
    b.dataset['sel'] = a.sel;
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="oh-glyph" aria-hidden="true">${a.glyph}</span><span class="oh-label">${a.label}</span>`;
    arc.appendChild(b);
    return b;
  });

  root.appendChild(arc);
  root.appendChild(fab);

  let pos = loadPos() ?? defaultPos();
  let open = false;

  const clamp = (p: Pos): Pos => ({
    x: Math.max(4, Math.min(p.x, window.innerWidth - FAB - 4)),
    // Keep clear of the toolbar above and the nav bar below.
    y: Math.max(90, Math.min(p.y, window.innerHeight - FAB - 90)),
  });

  const onRight = (): boolean => pos.x + FAB / 2 > window.innerWidth / 2;

  const place = (): void => {
    pos = clamp(pos);
    fab.style.left = `${pos.x}px`;
    fab.style.top = `${pos.y}px`;
    layoutArc();
  };

  function layoutArc(): void {
    const cx = pos.x + FAB / 2;
    const cy = pos.y + FAB / 2;
    // Straight "in from the edge": 180° for a right anchor, 0° for a left one.
    const base = onRight() ? 180 : 0;
    const n = buttons.length;
    const step = SPREAD_DEG / (n - 1);
    buttons.forEach((b, i) => {
      const deg = base - SPREAD_DEG / 2 + step * i;
      const rad = (deg * Math.PI) / 180;
      // A short arc near the top or bottom of the screen would push items off;
      // the radius shrinks rather than letting them leave the viewport.
      const r = Math.min(RADIUS, Math.max(88, Math.min(cy - 70, window.innerHeight - cy - 70) + 40));
      const x = cx + Math.cos(rad) * r - ITEM / 2;
      const y = cy + Math.sin(rad) * r - ITEM / 2;
      b.style.left = `${Math.max(4, Math.min(x, window.innerWidth - ITEM - 4))}px`;
      b.style.top = `${Math.max(4, Math.min(y, window.innerHeight - ITEM - 4))}px`;
      b.classList.toggle('oh-item--left', !onRight());
      // Stagger so the fan reads as one motion rather than six things appearing.
      b.style.transitionDelay = open ? `${i * 18}ms` : '0ms';
    });
  }

  const setOpen = (v: boolean): void => {
    open = v;
    arc.classList.toggle('open', v);
    fab.classList.toggle('open', v);
    fab.setAttribute('aria-expanded', String(v));
    layoutArc();
  };

  // ── Drag vs tap ────────────────────────────────────────────
  let dragging = false;
  let moved = false;
  let grab = { dx: 0, dy: 0 };

  fab.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    grab = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = e.clientX - grab.dx, ny = e.clientY - grab.dy;
    if (Math.hypot(nx - pos.x, ny - pos.y) > 3) moved = true;
    if (!moved) return;
    if (open) setOpen(false);
    pos = { x: nx, y: ny };
    place();
  });
  fab.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    fab.releasePointerCapture(e.pointerId);
    if (!moved) { setOpen(!open); return; }
    // Snap to the nearer edge so the anchor never floats mid-canvas.
    pos = { x: onRight() ? window.innerWidth - FAB - 10 : 10, y: pos.y };
    place();
    savePos(pos);
  });

  // ── Actions ────────────────────────────────────────────────
  for (const b of buttons) {
    b.addEventListener('click', () => {
      setOpen(false);
      const target = document.querySelector<HTMLElement>(b.dataset['sel'] ?? '');
      // Deliberately silent when a control is absent: the export button only
      // exists once a design is loaded, and a missing mirror should not throw.
      target?.click();
    });
  }

  const onDocPointer = (e: PointerEvent): void => {
    if (!open) return;
    const t = e.target as Node;
    if (!fab.contains(t) && !arc.contains(t)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocPointer, true);

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
  document.addEventListener('keydown', onKey);

  // ── Yield to whatever is already open ──────────────────────
  const sync = (): void => {
    const busy = !!document.querySelector('.left-panel.mob-open, .properties-panel.mob-open, .command-palette.open, .mob-pop.open');
    root.classList.toggle('oh-hidden', busy);
    if (busy && open) setOpen(false);
  };
  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });

  const onResize = (): void => { pos = clamp(pos); place(); };
  window.addEventListener('resize', onResize);

  place();
  sync();

  return () => {
    mo.disconnect();
    document.removeEventListener('pointerdown', onDocPointer, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    fab.remove();
    arc.remove();
  };
}
