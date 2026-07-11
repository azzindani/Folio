// WP-4.9 — pure geometry for on-canvas gradient handles. Mirrors the renderer's
// angle convention (fill-renderer.ts): a linear gradient's axis runs through the
// bbox center at (angle-90)°, endpoints at ±50% of the bbox. Kept DOM-free so
// canvas wiring and unit tests share one source of truth.

export interface Pt { x: number; y: number }   // bbox-fraction, 0..1

/** The two linear-gradient endpoints as bbox fractions for a given angle (deg). */
export function linearEndpoints(angle: number): { p1: Pt; p2: Pt } {
  const r = ((angle - 90) * Math.PI) / 180;
  const cx = Math.cos(r) * 0.5, sy = Math.sin(r) * 0.5;
  return { p1: { x: 0.5 - cx, y: 0.5 - sy }, p2: { x: 0.5 + cx, y: 0.5 + sy } };
}

/** New linear angle (deg, normalized 0–359) from dragging endpoint `which` to a
 *  point offset (dx,dy) from the bbox center (screen/user px; y down). */
export function angleFromDrag(dx: number, dy: number, which: 'p1' | 'p2'): number {
  // p2 direction = (cos(angle-90), sin(angle-90)); p1 is the opposite ray.
  const vx = which === 'p2' ? dx : -dx;
  const vy = which === 'p2' ? dy : -dy;
  const deg = (Math.atan2(vy, vx) * 180) / Math.PI + 90;
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** Radial center as a bbox fraction (cx/cy are stored as %). */
export function radialCenter(cx?: number, cy?: number): Pt {
  return { x: (cx ?? 50) / 100, y: (cy ?? 50) / 100 };
}

/** Radial radius-handle position (to the right of center), bbox fraction. */
export function radialRadiusPoint(cx?: number, cy?: number, radius?: number): Pt {
  return { x: (cx ?? 50) / 100 + (radius ?? 50) / 100, y: (cy ?? 50) / 100 };
}

/** New radius % from a radius-handle horizontal offset (px) over bbox width. */
export function radiusFromDrag(dxPx: number, bboxW: number): number {
  if (bboxW <= 0) return 50;
  return Math.max(1, Math.min(200, Math.round((Math.abs(dxPx) / bboxW) * 100)));
}
