/**
 * Ruler unit conversion utilities.
 * Base unit is always pixels; conversion uses 96 DPI standard.
 */

import type { RulerUnit } from '../editor/state';

/** Pixels per unit at 96 DPI */
const PX_PER_UNIT: Record<RulerUnit, number> = {
  px: 1,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
};

/** Convert pixels → display unit value */
export function pxToUnit(px: number, unit: RulerUnit): number {
  return px / PX_PER_UNIT[unit];
}

/** Convert display unit value → pixels */
export function unitToPx(value: number, unit: RulerUnit): number {
  return value * PX_PER_UNIT[unit];
}

/** Format a pixel value for display in the given unit */
export function formatRulerValue(px: number, unit: RulerUnit): string {
  const v = pxToUnit(px, unit);
  switch (unit) {
    case 'px': return Math.round(v).toString();
    case 'mm': return v.toFixed(1);
    case 'cm': return v.toFixed(2);
    case 'in': return v.toFixed(3);
  }
}

/** Cycle to the next unit in the standard sequence */
const UNIT_CYCLE: RulerUnit[] = ['px', 'mm', 'cm', 'in'];

export function nextRulerUnit(current: RulerUnit): RulerUnit {
  const idx = UNIT_CYCLE.indexOf(current);
  return UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length];
}

/**
 * Compute evenly-spaced tick values for a ruler.
 * @param startPx  viewport origin in px
 * @param endPx    viewport end in px
 * @param unit     display unit
 * @param zoom     current zoom level
 * @returns array of { px, label } tick marks
 */
export function computeRulerTicks(
  startPx: number,
  endPx: number,
  unit: RulerUnit,
  zoom: number,
): { px: number; label: string }[] {
  const pxPerUnit = PX_PER_UNIT[unit];
  // Target ~60px between ticks in screen space
  const screenPxPerTick = 60;
  const designPxPerTick = screenPxPerTick / zoom;
  const unitsPerTick = designPxPerTick / pxPerUnit;

  // Round to a nice interval
  const nice = niceInterval(unitsPerTick);
  const niceDesignPx = nice * pxPerUnit;

  const firstTick = Math.ceil(startPx / niceDesignPx) * niceDesignPx;
  const ticks: { px: number; label: string }[] = [];

  for (let pos = firstTick; pos <= endPx; pos += niceDesignPx) {
    ticks.push({ px: pos, label: formatRulerValue(pos, unit) });
  }
  return ticks;
}

function niceInterval(raw: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  if (normalized < 1.5) return magnitude;
  if (normalized < 3.5) return 2 * magnitude;
  if (normalized < 7.5) return 5 * magnitude;
  return 10 * magnitude;
}
