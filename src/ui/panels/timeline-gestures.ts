// Two-finger pinch on the timeline sheet: the time scale follows the distance between the fingers, about their midpoint.
// A touch keeps delivering events to the element it started on even once that element is gone, so the sheet must not be
// REBUILT while the fingers are down: `setScale` only resizes it, and `end` is where it is redrawn.
// (Ctrl + wheel, which a trackpad pinch also sends, is the panel's own handler.) The sheet sets `touch-action: pan-x pan-y`,
// so the browser pans it with one finger and leaves two to us.

export interface PinchApi {
  /** Two fingers are down: hold off redraws that would replace the nodes the touch is attached to. */
  begin(): void;
  /** The fingers are up: redraw once, at the final scale. */
  end(): void;
  /** The scale now, px per ms. */
  scale(): number;
  /** Ask for a scale, holding the moment `anchorPx` from the track's left edge in place. */
  setScale(pxPerMs: number, anchorPx: number): void;
  /** Width of the label column the track starts after, px. */
  labelW: number;
}

const gap = (t: TouchList): number => Math.hypot((t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0), (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0));

export function bindPinch(body: HTMLElement, api: PinchApi): void {
  let start: { dist: number; scale: number } | null = null;
  let frame = 0;
  body.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { start = { dist: Math.max(1, gap(e.touches)), scale: api.scale() }; api.begin(); }
  }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    const s = start, ratio = gap(e.touches) / s.dist;
    const mid = ((e.touches[0]?.clientX ?? 0) + (e.touches[1]?.clientX ?? 0)) / 2 - body.getBoundingClientRect().left;
    // One redraw per frame: a redraw rebuilds the sheet, and touches arrive faster than that.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => api.setScale(s.scale * ratio, Math.max(0, mid - api.labelW)));
  }, { passive: false });
  const end = (): void => { if (!start) return; start = null; cancelAnimationFrame(frame); api.end(); };
  body.addEventListener('touchend', end, { passive: true });
  body.addEventListener('touchcancel', end, { passive: true });
}
