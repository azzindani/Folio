/**
 * The box width a split-off unit's text layer needs so the renderer does not
 * wrap it again.
 *
 * A unit is PLACED by the font's measured advances, but the renderer WRAPS by
 * its own per-character estimate — and for a bold display word the estimate
 * runs wider than the measurement. Live: "every" in Archivo 800 at 120px
 * measured 305px, the wrap rule wanted 312px and broke the word, and the "y"
 * dropped to a second line that its mask then hid — with no mask in sight of
 * the cause. The box takes the larger of the two.
 */

import { plainTextLayout } from '../../renderer/layer-renderers-shared';

export function unitWidth(text: string, style: Record<string, unknown>, measured: number): number {
  // No box width → no wrap → the renderer's own width for the whole run.
  const estimate = plainTextLayout(text, style as never, {}).lineWidths[0] ?? 0;
  return Math.max(1, Math.ceil(Math.max(measured, estimate)));
}
