// Folio editor — canvas touch gestures.
//
// The canvas was built for a mouse: zoom is ctrl+wheel, pan is wheel, and the
// context menu is the `contextmenu` event. A phone has none of those, so on
// touch the canvas could only select and drag layers — you could not move the
// view at all without switching to the Pan tool, and the context menu was
// unreachable.
//
// This adds the four gestures a phone user already knows, without touching the
// pointer path that select/drag/resize relies on:
//
//   two fingers        pinch to zoom (anchored between the fingers) + pan
//   one finger, empty  drag to pan the view
//   long press         context menu (dispatches a real `contextmenu` event)
//   double tap         edit (dispatches `dblclick` only if the browser did not)
import type { StateManager } from './state';
import { RULER_SIZE } from './canvas-draw';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 12;      // movement still counted as a tap, not a drag
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 28;

interface Point { x: number; y: number }

const mid = (a: Touch, b: Touch): Point => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const dist = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/** True when the touch landed on empty canvas rather than a layer or a handle. */
function onEmptyCanvas(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el?.closest) return true;
  return !el.closest('[data-layer-id], .canvas-handle, .canvas-selection-box, .gradient-handle, .ruler-h, .ruler-v');
}

/** Re-dispatch a touch point as a mouse event the existing handlers understand. */
function mouseAt(el: Element, type: string, p: Point): void {
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true,
    clientX: p.x, clientY: p.y, button: type === 'contextmenu' ? 2 : 0,
  }));
}

/**
 * Wire the gestures onto a canvas pane.
 *
 * Listeners are non-passive because a pan or a pinch must beat the browser's
 * own scroll/zoom; single-finger touches on a LAYER are left entirely alone so
 * drag-to-move keeps working through the pointer events it already uses.
 */
export function wireTouchGestures(pane: HTMLElement, state: StateManager): void {
  // Marks the wired pane — the gestures are silently useless if the pane the
  // canvas actually renders into is not this one, and that is invisible from
  // the outside otherwise.
  pane.dataset['folioGestures'] = '1';
  let panning = false;
  let pinching = false;
  let last: Point = { x: 0, y: 0 };
  let startDist = 0;
  let startZoom = 1;
  let longPressTimer: number | undefined;
  let lastTap = { t: 0, x: 0, y: 0 };
  let browserDblClick = 0;

  pane.addEventListener('dblclick', () => { browserDblClick = Date.now(); });

  const clearLongPress = (): void => {
    if (longPressTimer !== undefined) { window.clearTimeout(longPressTimer); longPressTimer = undefined; }
  };

  /** Canvas-local coordinates, matching how panX/panY are applied. */
  const local = (p: Point): Point => {
    const r = pane.getBoundingClientRect();
    return { x: p.x - r.left - RULER_SIZE, y: p.y - r.top - RULER_SIZE };
  };

  pane.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!a || !b) return;
      pinching = true;
      panning = false;
      clearLongPress();
      startDist = dist(a, b) || 1;
      startZoom = state.get().zoom ?? 1;
      last = mid(a, b);
      e.preventDefault();
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!t) return;
    last = { x: t.clientX, y: t.clientY };

    // Long press works anywhere — on a layer it is "act on this layer", on
    // empty canvas it is "act on the design".
    const target = e.target as Element | null;
    const at = { x: t.clientX, y: t.clientY };
    longPressTimer = window.setTimeout(() => {
      longPressTimer = undefined;
      panning = false;
      if (target) mouseAt(target, 'contextmenu', at);
    }, LONG_PRESS_MS);

    if (onEmptyCanvas(e.target)) {
      panning = true;
      e.preventDefault();   // no marquee, no browser scroll — this is a pan
    }
  }, { passive: false });

  pane.addEventListener('touchmove', (e: TouchEvent) => {
    if (pinching && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!a || !b) return;
      e.preventDefault();
      const m = mid(a, b);
      const scale = dist(a, b) / startDist;
      const { panX = 0, panY = 0 } = state.get();
      const zoom = state.get().zoom ?? 1;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * scale));
      // Keep the design point between the fingers under the fingers, and carry
      // any midpoint movement as a pan in the same gesture.
      const lm = local(m), ll = local(last);
      const designX = (ll.x - panX) / zoom;
      const designY = (ll.y - panY) / zoom;
      state.batch(() => {
        state.set('zoom', next, false);
        state.set('panX', lm.x - designX * next, false);
        state.set('panY', lm.y - designY * next, false);
      });
      last = m;
      return;
    }
    if (!e.touches.length) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - last.x, dy = t.clientY - last.y;
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) clearLongPress();
    if (!panning) return;
    e.preventDefault();
    const { panX = 0, panY = 0 } = state.get();
    state.batch(() => {
      state.set('panX', panX + dx, false);
      state.set('panY', panY + dy, false);
    });
    last = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  const end = (e: TouchEvent): void => {
    clearLongPress();
    if (e.touches.length === 0) { pinching = false; panning = false; }
    const t = e.changedTouches[0];
    if (!t || pinching) return;

    // Double tap → edit. Chromium usually synthesises dblclick from two taps;
    // only fill in when it did not, so text editors never open twice.
    const now = Date.now();
    const near = Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < DOUBLE_TAP_SLOP;
    if (now - lastTap.t < DOUBLE_TAP_MS && near) {
      lastTap = { t: 0, x: 0, y: 0 };
      window.setTimeout(() => {
        if (Date.now() - browserDblClick > DOUBLE_TAP_MS) {
          // Aim at the LAYER the finger actually hit. The touch's own target is
          // the browser's hit-test result, which beats re-testing the point:
          // the selection overlay covers the canvas, and a dblclick landing
          // there has no [data-layer-id] ancestor, so the editor never opens.
          const hit = t.target as Element | null;
          const stack = document.elementsFromPoint?.(t.clientX, t.clientY) ?? [];
          const el = (hit?.closest?.('[data-layer-id]') ? hit : null)
            ?? stack.find(n => n.closest?.('[data-layer-id]'))
            ?? document.elementFromPoint(t.clientX, t.clientY);
          if (el) mouseAt(el, 'dblclick', { x: t.clientX, y: t.clientY });
        }
      }, 40);
      return;
    }
    lastTap = { t: now, x: t.clientX, y: t.clientY };
  };
  pane.addEventListener('touchend', end);
  pane.addEventListener('touchcancel', end);
}
