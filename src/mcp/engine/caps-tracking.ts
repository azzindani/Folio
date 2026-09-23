/**
 * When ALL-CAPS wants tracking — one rule shared by the add_layers rescue pass
 * (fixCapsTracking) and the ai_slop lint, so the engine never nags about what
 * it would not fix, nor fixes what it would not nag about.
 *
 * Caps at TEXT sizes read cramped without ~0.06em. Caps at DISPLAY sizes are
 * the designer's call: the guide itself asks for -2..-1 on big headlines, and a
 * condensed 1250px word needs no help. The first benchmark run found the rescue
 * pass replacing a model's deliberate -3 on four 160px headlines with +10px —
 * the headline wrapped to three lines and into the artwork.
 *
 * Display is judged against the canvas: 150px is body copy on a 3508px A3.
 */

/** Tracking caps want at text sizes, in em. */
export const CAPS_EM = 0.06;

/** Smallest display size in px, whatever the canvas. */
const DISPLAY_MIN_PX = 72;

/** Share of the canvas's short side at which type reads as display. */
const DISPLAY_SHARE = 0.06;

/** ~0.06em in whole px, never below 1. */
export function capsFloorPx(size: number): number {
  return Math.max(1, Math.round(size * CAPS_EM));
}

/** True when text this size is display type on a canvas whose short side is `canvasShort`. */
export function isDisplaySize(size: number, canvasShort?: number): boolean {
  return size >= Math.max(DISPLAY_MIN_PX, (canvasShort ?? 0) * DISPLAY_SHARE);
}
