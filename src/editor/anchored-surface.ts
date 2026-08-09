// Folio editor — a floating surface that tracks the current selection.
//
// THE RULE THIS ENFORCES. A bottom sheet is right for a LIST you browse —
// layers, tools, panels — because you are choosing what to work on. It is wrong
// for COMMANDS you fire at something already chosen: those belong beside the
// thing, exactly where a desktop right-click puts them. Reaching to the bottom
// of the screen to act on an object at the top is a round trip the mouse never
// has to make, and on a phone you make it constantly.
//
// Shared by the selection bar and the quick inspector. It owns the four
// behaviours an anchored surface has to get right, none of which are about
// what the surface contains:
//
//   FOLLOW   re-anchors on selection, zoom, pan and geometry changes
//   YIELD    hides while a sheet, popover, menu or the palette is open
//   RELEASE  hides for the duration of a canvas gesture — nothing floats
//            under the finger that is dragging, panning or pinching
//   LEAVE    disappears with the selection when it is panned off-screen
import type { StateManager, EditorState } from './state';
import { placeNear, unionRect, intersects, type Rect, type Bounds } from './anchor-place';

/** Anything whose presence means the user is looking at something else. */
const BUSY_SELECTOR = '.left-panel.mob-open, .properties-panel.mob-open, '
  + '.mob-pop.open, .command-palette.open, .export-menu.open, .toolbar-more-menu.open';

const FOLLOW_KEYS: (keyof EditorState)[] = ['selectedLayerIds', 'design', 'zoom', 'panX', 'panY', 'currentPageIndex', 'mode'];

/** The on-screen box of the selection, read from the overlay the canvas draws.
 *  Going through the overlay rather than the layer's own x/y means zoom, pan,
 *  rotation and group transforms are already applied. */
export function selectionRect(root: ParentNode): Rect | null {
  const multi = root.querySelector('.selection-box--multi');
  const boxes = multi ? [multi] : [...root.querySelectorAll('.selection-box')];
  return unionRect(boxes.map(el => el.getBoundingClientRect()));
}

/** The band a surface may occupy: inside the canvas pane, above the fixed
 *  bottom nav, which paints over the canvas rather than shortening it. */
export function paneBounds(): Bounds {
  const pane = document.querySelector('.canvas-area')?.getBoundingClientRect();
  const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
  const navTop = nav && nav.height > 0 ? nav.top : window.innerHeight;
  const top = (pane?.top ?? 0) + 6;
  const bottom = Math.min(pane?.bottom ?? window.innerHeight, navTop) - 6;
  return {
    top,
    bottom: Math.max(top + 1, bottom),
    left: (pane?.left ?? 0) + 6,
    right: Math.max((pane?.left ?? 0) + 7, (pane?.right ?? window.innerWidth) - 6),
  };
}

export interface SurfaceOptions {
  /** Class on the floating element. */
  className: string;
  /** Extra condition for being visible at all (the inspector is on-demand). */
  visible?: () => boolean;
  /** Rebuild contents before each show — the selection may have changed type. */
  render?: (el: HTMLElement) => void;
}

export class AnchoredSurface {
  readonly el: HTMLElement;
  private state: StateManager;
  private opts: SurfaceOptions;
  private frame = 0;
  private gesture = false;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, state: StateManager, opts: SurfaceOptions) {
    this.state = state;
    this.opts = opts;
    this.el = document.createElement('div');
    this.el.className = `${opts.className} anc-surface`;
    this.el.setAttribute('role', 'toolbar');
    container.appendChild(this.el);

    this.disposers.push(state.subscribe((_s, keys) => {
      if (keys.some(k => FOLLOW_KEYS.includes(k))) this.schedule();
    }));

    // A canvas gesture owns the screen while it lasts. Suppressing on
    // pointerdown covers drag, resize, marquee, pan and pinch in one rule
    // rather than trying to enumerate them.
    const down = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (this.el.contains(t)) return;
      if (!t?.closest?.('.canvas-area')) return;
      this.gesture = true;
      this.el.classList.remove('anc-open');
    };
    const up = (): void => {
      if (!this.gesture) return;
      this.gesture = false;
      // After the canvas has settled its own state for the release.
      window.setTimeout(() => this.schedule(), 60);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    this.disposers.push(() => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    });

    // Sheets and popovers toggle a class rather than mounting, so watch classes.
    // Skipping the surfaces' own classes is load-bearing, not tidiness: showing
    // one flips a class, which would re-enter this observer every frame.
    const mo = new MutationObserver((records) => {
      if (records.every(r => (r.target as Element).closest?.('.anc-surface'))) return;
      this.schedule();
    });
    mo.observe(container, { attributes: true, attributeFilter: ['class'], subtree: true });
    this.disposers.push(() => mo.disconnect());

    // The context menu mounts on <body>, outside the container above, so its
    // opening AND its closing have to be watched here — otherwise dismissing it
    // leaves the surface hidden until something else happens to change state.
    const bodyMo = new MutationObserver(() => this.schedule());
    bodyMo.observe(document.body, { childList: true });
    this.disposers.push(() => bodyMo.disconnect());

    const onResize = (): void => this.schedule();
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));
  }

  /** Coalesce the bursts of state changes a single drag or zoom produces. */
  schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  private hide(): void { this.el.classList.remove('anc-open'); }

  refresh(): void {
    const busy = !!document.querySelector(BUSY_SELECTOR) || !!document.querySelector('.canvas-context-menu');
    if (this.gesture || busy || this.opts.visible?.() === false
      || this.state.get().mode !== 'visual' || !this.state.get().selectedLayerIds.length) {
      this.hide();
      return;
    }
    const target = selectionRect(document);
    const bounds = paneBounds();
    if (!target || !intersects(target, bounds)) { this.hide(); return; }

    this.opts.render?.(this.el);
    // The closed state is `visibility: hidden`, not `display: none`, so the
    // surface has real layout before it is ever shown: the first placement uses
    // its true size instead of zero and lands in the right spot immediately.
    const size = { width: this.el.offsetWidth, height: this.el.offsetHeight };
    if (!size.width || !size.height) { this.hide(); return; }

    const p = placeNear(target, size, bounds);
    this.el.style.left = `${Math.round(p.x)}px`;
    this.el.style.top = `${Math.round(p.y)}px`;
    this.el.dataset['placement'] = p.placement;
    this.el.classList.add('anc-open');
  }

  destroy(): void {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    for (const d of this.disposers) d();
    this.el.remove();
  }
}
