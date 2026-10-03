// The timeline's time scale — pure.
//
// A row positions everything in % of its track area, so zooming is only the WIDTH of the sheet the rows sit
// in: `null` is "fit" (the scene exactly fills the view, as the panel always drew it), a number is pixels per
// ms and the sheet may be wider than the view, which then scrolls. Ticks on the ruler follow the scale: the
// finest step that still leaves a readable label between marks.

/** Zoom limits in px per ms: 1 px per 40 ms is a whole minute in 1500 px; 1 px per 0.5 ms shows single frames. */
export const MIN_PX_PER_MS = 0.025, MAX_PX_PER_MS = 2;
/** Ticks, ms. A label needs at least this many px before the next one. */
const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const LABEL_PX = 64;

/** The sheet's track width in px: `fit` (null) fills the view, a scale may exceed it but never fall short of it. */
export function trackWidth(durationMs: number, zoom: number | null, viewPx: number): number {
  const view = Math.max(40, viewPx);
  return zoom === null ? view : Math.max(view, Math.round(durationMs * zoom));
}

/** px per ms of the fitted view. */
export const fitScale = (durationMs: number, viewPx: number): number => Math.max(40, viewPx) / Math.max(1, durationMs);

/** A requested scale held to the limits; at or below the fit it IS the fit (null), so the ruler never floats short of the view. */
export function clampZoom(pxPerMs: number, durationMs: number, viewPx: number): number | null {
  const scale = Math.min(MAX_PX_PER_MS, pxPerMs);
  return scale <= fitScale(durationMs, viewPx) * 1.001 ? null : Math.max(MIN_PX_PER_MS, scale);
}

/** The scale one step in or out (×1.5 per step) from `current` (null = fit). */
export function stepZoom(current: number | null, dir: 1 | -1, durationMs: number, viewPx: number): number | null {
  const now = current ?? fitScale(durationMs, viewPx);
  return clampZoom(dir > 0 ? now * 1.5 : now / 1.5, durationMs, viewPx);
}

/**
 * The scroll position that keeps the moment under `anchorPx` (its x within the view) where it was while the
 * scale changes from `before` to `after` px per ms.
 */
export function scrollAfterZoom(scrollLeft: number, anchorPx: number, before: number, after: number): number {
  const ms = (scrollLeft + anchorPx) / before;
  return Math.max(0, Math.round(ms * after - anchorPx));
}

/** The tick spacing, ms, for a scale: the finest step whose labels clear LABEL_PX. */
export function tickStep(pxPerMs: number): number {
  return STEPS.find(s => s * pxPerMs >= LABEL_PX) ?? STEPS[STEPS.length - 1] ?? 600_000;
}

export interface Tick { ms: number; label: string | null }

/** "3.5s" under a second of step, "12s" in whole seconds, "1:05" from a minute on. */
export function tickLabel(ms: number, step: number): string {
  const s = ms / 1000;
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return step < 1000 ? `${s.toFixed(step < 100 ? 2 : 1)}s` : `${Math.round(s)}s`;
}

/** The ruler's marks over [0, durationMs]: a labelled one every step, an unlabelled one between when they are far enough apart. */
export function rulerTicks(durationMs: number, pxPerMs: number): Tick[] {
  const step = tickStep(pxPerMs);
  const minor = step / 5 * pxPerMs >= 8 ? step / 5 : step / 2 * pxPerMs >= 14 ? step / 2 : 0;
  const out: Tick[] = [];
  const end = Math.max(0, durationMs);
  const unit = minor || step;
  for (let ms = 0; ms <= end + 0.5; ms += unit) {
    const t = Math.round(ms * 1000) / 1000;
    out.push({ ms: t, label: Math.abs(t / step - Math.round(t / step)) < 1e-6 ? tickLabel(t, step) : null });
  }
  return out;
}
