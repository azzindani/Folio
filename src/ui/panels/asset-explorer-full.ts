// Asset explorer — full-window mode.
//
// The docked panel cannot be a file manager and it was never going to be. The
// editor grid protects a canvas floor, so on a 1280px window the left column
// resolves to roughly 400px however wide the panel asks to be — under the width
// at which the tree docks. Everything that makes the manager a manager (a tree
// of projects beside the files, a details table, a row of verbs that fits on
// one line) needs a window, so clicking "Project assets" opens one.

/** Remembers whether the manager was left full-window or docked in the rail. */
const FULL_KEY = 'folio-assets:full';

/** What the manager has to expose for its window to be driven from out here. */
export interface FullHost {
  /** The panel's host element — the thing that goes fixed/inset-0. */
  container: HTMLElement;
  /** Repaint after the frame changes size. */
  render(): void;
  /** True when something is selected, so Escape can clear it first. */
  hasSelection(): boolean;
  clearSelection(): void;
}

/** Close whatever is layered over the file pane; true if there was anything. */
function closeLayers(container: HTMLElement): boolean {
  const menu = container.querySelector<HTMLElement>('.ax-viewmenu');
  if (menu && !menu.hidden) { menu.hidden = true; return true; }
  const places = container.querySelector('.ax-tree.open');
  if (places) { places.classList.remove('open'); return true; }
  return false;
}

/** Read the remembered preference. Full window unless explicitly restored. */
function prefersFull(): boolean {
  try { return localStorage.getItem(FULL_KEY) !== '0'; } catch { return true; }
}

function remember(on: boolean): void {
  try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

/**
 * Owns the full-window frame and the Escape key that leaves it.
 *
 * Positioned on the HOST element, so no DOM moves between the two modes — the
 * same panel in a bigger frame.
 */
export class FullWindow {
  private on = false;
  private host: FullHost;

  constructor(host: FullHost) {
    this.host = host;
  }

  get active(): boolean {
    return this.on;
  }

  toggle(on = !this.on): void {
    this.on = on;
    this.host.container.classList.toggle('ax-full', on);
    if (on) document.addEventListener('keydown', this.onEscape, true);
    else document.removeEventListener('keydown', this.onEscape, true);
    remember(on);
    this.host.render();
  }

  /**
   * Open it the way the person who clicked "Project assets" meant it.
   *
   * Called only from that click — the panel is also constructed as a side
   * effect of opening a design, and taking over the screen when nobody asked
   * for the manager would bury the canvas.
   */
  openForBrowsing(): void {
    const want = prefersFull();
    if (want !== this.on) this.toggle(want);
  }

  /**
   * Escape unwinds one layer at a time, innermost first: an open menu, then a
   * selection, and only then the window itself.
   *
   * Without the first step, pressing Escape to dismiss the view picker tore
   * down the whole manager and dropped you back on the canvas — the key that
   * means "never mind" doing the most destructive thing on offer.
   */
  private onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !this.on) return;
    // Switching to another view hides this one by display:none without telling
    // us. The listener is still on the document, so Escape pressed while
    // working on the canvas would quietly flip the manager back to docked and
    // remember that as a preference the user never expressed.
    if (!this.host.container.getClientRects().length) return;
    if (closeLayers(this.host.container)) { ev.stopPropagation(); return; }
    if (this.host.hasSelection()) { this.host.clearSelection(); return; }
    ev.stopPropagation();
    this.toggle(false);
  };
}
