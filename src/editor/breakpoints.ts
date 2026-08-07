// One definition of "is this the touch layout?", shared by every module that
// used to ask `(max-width: 1023px)` on its own.
//
// Width alone is the wrong question. A desktop window dragged narrow is still
// a desktop — mouse, hover, keyboard, precise pointing — and giving it the
// tablet treatment (overlay panels, a ⋯ toolbar sheet, 44px targets) takes
// away controls it can perfectly well use. Only a COARSE pointer justifies
// that trade, so both conditions must hold. The CSS media queries in
// main.css are gated identically; if you change one, change both.

export const TOUCH_LAYOUT_MQ = '(max-width: 1023px) and (pointer: coarse)';
export const PHONE_LAYOUT_MQ = '(max-width: 767px) and (pointer: coarse)';

/** True when the viewport AND the input device call for the touch layout. */
export function isTouchLayout(): boolean {
  return window.matchMedia?.(TOUCH_LAYOUT_MQ).matches ?? false;
}

/** True on a phone-sized touchscreen (bottom sheets, single-column grid). */
export function isPhoneLayout(): boolean {
  return window.matchMedia?.(PHONE_LAYOUT_MQ).matches ?? false;
}

/**
 * A desktop window too narrow to show both panels AND a usable canvas.
 *
 * The grid clamps panel widths so the canvas keeps its floor, but below this
 * the left panel would be squeezed to a sliver that shows nothing useful. It
 * starts collapsed instead — the activity bar puts it back in one click, and
 * the canvas gets the space until then. Only at LOAD: a running session must
 * not have its panels yanked away mid-resize.
 */
export function isNarrowDesktop(): boolean {
  return (window.matchMedia?.(NARROW_DESKTOP_MQ).matches ?? false);
}

/**
 * 1199px, not 1023px. With both panels open the chrome costs 656px, so a
 * 1150px window left the canvas 492px — 34% of the screen, the design at 38%
 * zoom — to show four layer names. 1280 is a common laptop width and keeps
 * both panels; below that, layers yields first.
 */
export const NARROW_DESKTOP_MQ = '(max-width: 1199px) and (pointer: fine)';
