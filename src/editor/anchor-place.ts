// Folio editor — place a floating surface next to the thing it acts on.
//
// Shared by the touch selection bar and the quick inspector. Kept pure and
// separate because "where does the popup go" is the whole UX question here and
// it should be provable without a browser.
//
// PREFER BELOW. A phone is held from the bottom, so a control placed BELOW the
// selection is reached without the hand crossing over — and therefore without
// covering — the thing being edited. Above is the fallback for a selection
// sitting on the floor of the pane, not the default.

export interface Rect { x: number; y: number; width: number; height: number }

/** The area the surface may occupy, in viewport px (toolbar top, nav bottom…). */
export interface Bounds { top: number; right: number; bottom: number; left: number }

export interface Size { width: number; height: number }

export type Placement = 'below' | 'above' | 'over';

export interface Placed { x: number; y: number; placement: Placement }

const clamp = (v: number, lo: number, hi: number): number =>
  hi < lo ? lo : Math.max(lo, Math.min(v, hi));

/**
 * Position `size` beside `target`, inside `bounds`.
 *
 * `gap` is the breathing room between the surface and the selection edge; it is
 * also what keeps the surface off the resize handles, which sit ON the edge.
 */
export function placeNear(target: Rect, size: Size, bounds: Bounds, gap = 12): Placed {
  const belowY = target.y + target.height + gap;
  const aboveY = target.y - gap - size.height;

  let placement: Placement;
  let y: number;
  if (belowY + size.height <= bounds.bottom) {
    placement = 'below';
    y = belowY;
  } else if (aboveY >= bounds.top) {
    placement = 'above';
    y = aboveY;
  } else {
    // The selection spans the whole pane (a full-bleed background, a zoomed-in
    // layer). Sitting on top of it is the only option left; hug its lower edge,
    // where it overlaps the least of what you are looking at.
    placement = 'over';
    y = target.y + target.height - size.height - gap;
  }

  const x = clamp(target.x + target.width / 2 - size.width / 2,
    bounds.left, bounds.right - size.width);
  return { x, y: clamp(y, bounds.top, bounds.bottom - size.height), placement };
}

/**
 * Union of a set of viewport rects, or null when there are none.
 *
 * The selection's on-screen box is the union of the overlay boxes the canvas
 * already draws, which means zoom, pan and rotation are accounted for without
 * this module knowing anything about the canvas transform.
 */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** True when `r` has any overlap with the visible band — an off-screen
 *  selection should take its options off-screen with it, not park them at an
 *  edge pointing at nothing. */
export function intersects(r: Rect, b: Bounds): boolean {
  return r.x < b.right && r.x + r.width > b.left
    && r.y < b.bottom && r.y + r.height > b.top;
}
