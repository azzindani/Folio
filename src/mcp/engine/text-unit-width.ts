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
  let width = Math.max(1, Math.ceil(Math.max(measured, estimate)));
  // Neither number IS the wrap rule: lineWidths subtracts a negative
  // letter_spacing that wrapping never applies. Live: "Every" in Archivo 800 at
  // 200px with -6 tracking got a 501px box, and its "y" fell to a hidden second
  // line. So ask the wrap rule itself, growing the box until the unit stays whole.
  const fontSize = typeof style['font_size'] === 'number' ? style['font_size'] : 16;
  const step = Math.max(1, Math.ceil(fontSize * 0.05));
  for (let i = 0; i < 400 && wraps(text, style, width); i++) width += step;
  return width;
}

function wraps(text: string, style: Record<string, unknown>, width: number): boolean {
  return plainTextLayout(text, style as never, { width }).lines.length > 1;
}
