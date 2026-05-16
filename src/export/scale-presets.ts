/**
 * Export scale presets — shared single source of truth for "what scale
 * multipliers does the UI offer for PNG/PDF rasterization?".
 *
 * The document's W×H is logical pixels at the standard 96 DPI screen
 * density. Multiplying by `scale` produces the rasterized pixel count.
 * Effective DPI for print = `scale × 96`.
 *
 *   scale 1   →  96 DPI  (screen, base resolution)
 *   scale 2   → 192 DPI  (retina; common "PNG @2x")
 *   scale 3   → 288 DPI  (high-quality print)
 *   scale 4   → 384 DPI  (premium print)
 *   scale 6.25→ 600 DPI  (commercial print, magazines)
 *
 * Browser canvas has a hard pixel ceiling — see canvas-limit.ts. Picking
 * a preset that exceeds the doc's max scale yields a clamped error from
 * exportToPNG rather than a silently blank image.
 */

export interface ScalePreset {
  /** Stable identifier used as <select> value. */
  id: string;
  /** Display label in the picker. */
  label: string;
  /** Multiplier applied to document W and H. */
  scale: number;
  /** Effective print DPI = scale × 96 (informational only). */
  dpi: number;
  /** Long-form description for tooltips. */
  description: string;
}

const SCREEN_DPI = 96;

function preset(id: string, label: string, scale: number, description: string): ScalePreset {
  return { id, label, scale, dpi: Math.round(scale * SCREEN_DPI), description };
}

/**
 * Ordered list of scale presets, lowest to highest. The UI uses this
 * verbatim — change the order/labels here, not in the dialogs.
 */
export const EXPORT_SCALE_PRESETS: readonly ScalePreset[] = [
  preset('x1',        'PNG ×1 (screen)',     1,    '96 DPI — base screen resolution'),
  preset('x2',        'PNG ×2 (retina)',     2,    '192 DPI — recommended for screens & retina displays'),
  preset('x3',        'PNG ×3 (HD print)',   3,    '288 DPI — high-quality home/office print'),
  preset('x4',        'PNG ×4 (premium)',    4,    '384 DPI — premium print, posters'),
  preset('print-300', 'Print 300 DPI',       300 / SCREEN_DPI, '300 DPI — standard offset / commercial print'),
  preset('print-600', 'Print 600 DPI',       600 / SCREEN_DPI, '600 DPI — magazine / fine-art print'),
] as const;

/** The default preset used when no choice has been made. */
export const DEFAULT_SCALE_PRESET_ID = 'x2';

/** Convenience lookup. Returns undefined for unknown ids. */
export function getScalePreset(id: string): ScalePreset | undefined {
  return EXPORT_SCALE_PRESETS.find(p => p.id === id);
}

/** The default ScalePreset (always defined; guaranteed by tests). */
export function defaultScalePreset(): ScalePreset {
  const p = getScalePreset(DEFAULT_SCALE_PRESET_ID);
  if (!p) throw new Error(`DEFAULT_SCALE_PRESET_ID "${DEFAULT_SCALE_PRESET_ID}" not found in EXPORT_SCALE_PRESETS`);
  return p;
}
