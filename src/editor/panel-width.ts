// Left-panel width, per view.
//
// The left panel is one column shared by every view, and its width was set for
// the narrowest of them: a list of layer names is perfectly happy at 260px.
// The asset manager is not a list — it is a file manager, with a tree of
// projects down the side, a row of verbs on top and a details table of name /
// size / type / added. None of that fits in 260px, and none of it degrades
// gracefully: the tree stays folded away, the verbs scroll off the right edge
// with no scrollbar to say so, and the filename column squeezes to nothing.
//
// The result was a rebuilt file manager that looked byte-for-byte like the
// panel it replaced, because everything new about it was off-screen. So the
// view asks for the room it needs when it opens, and gives it back when it
// closes.

/** Views that need more room than the default, and how much they need.
 *
 *  520px is where the manager docks its tree (`is-wide` in the panel's own
 *  CSS); 560 clears that with enough left for the details columns. */
const NEEDS: Readonly<Record<string, number>> = { 'project-assets': 560 };

const VAR = '--left-panel-width';

/** Ceiling — matches the resize handle's own maximum. */
const MAX_PX = 720;

/**
 * Widens the left panel for views that need it, and restores the width the
 * user had before.
 *
 * Only ever widens. A panel the user has already dragged wider than the view
 * asks for is left exactly as it is — the request is a floor, not a setting.
 */
export class ViewWidth {
  /** Width to go back to when leaving a wide view; null when not widened. */
  private prior: number | null = null;
  /** What we set on entry, so a width the user changed since can be told apart
   *  from one they never touched. */
  private applied = 0;

  constructor(private readonly root: HTMLElement = document.documentElement) {}

  private current(): number {
    const inline = this.root.style.getPropertyValue(VAR).trim();
    const raw = inline || getComputedStyle(this.root).getPropertyValue(VAR).trim();
    return parseInt(raw, 10) || 0;
  }

  private set(px: number): void {
    this.root.style.setProperty(VAR, `${px}px`);
  }

  /**
   * Called on every view switch.
   *
   * Entering a hungry view widens; leaving it hands the width back — unless the
   * user resized while they were in there, in which case that is their choice
   * and it stands.
   */
  apply(panelId: string): void {
    const need = NEEDS[panelId];

    if (need === undefined) {
      // Leaving. Restore only what we took, and only if untouched since.
      if (this.prior !== null && this.current() === this.applied) this.set(this.prior);
      this.prior = null;
      this.applied = 0;
      return;
    }

    if (this.prior !== null) return;          // already in a wide view
    const now = this.current();
    if (now >= need) return;                  // roomy enough already — leave it alone
    this.prior = now;
    this.applied = Math.min(need, MAX_PX);
    this.set(this.applied);
  }
}
