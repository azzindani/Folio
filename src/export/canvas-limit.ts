/**
 * Browser canvas dimension limits.
 *
 * Every browser has a hard ceiling on canvas width/height (and on the
 * total pixel area). Exceeding either silently produces a blank or
 * stretched image — never a thrown error from the platform.
 *
 * We use Chrome's limit (16384) as the safe default since Folio targets
 * Chromium for rendering. Firefox actually allows ~32767, Safari ~16384,
 * so 16384 is the lowest-common-denominator that still fits big posters
 * (a 1080×1920 doc at scale ×8 = 8640×15360 — within budget).
 *
 * Caller pattern:
 *   const guard = checkCanvasScale(docW, docH, scale);
 *   if (!guard.ok) throw new Error(guard.reason);
 */

export const MAX_CANVAS_DIM = 16384;

export interface CanvasScaleCheck {
  ok: boolean;
  /** Effective pixel width  (docW × scale). */
  width: number;
  /** Effective pixel height (docH × scale). */
  height: number;
  /** Largest scale value the document can be safely rasterized at. */
  maxScale: number;
  /** Human-readable failure reason; empty when ok. */
  reason: string;
}

/**
 * Returns whether (docW, docH, scale) fits within the browser canvas
 * limit, plus the largest scale that *would* fit so the caller can
 * suggest it to the user.
 */
export function checkCanvasScale(docW: number, docH: number, scale: number): CanvasScaleCheck {
  const width  = Math.ceil(docW * scale);
  const height = Math.ceil(docH * scale);
  const maxScale = Math.floor((MAX_CANVAS_DIM / Math.max(docW, docH)) * 100) / 100;

  if (width > MAX_CANVAS_DIM || height > MAX_CANVAS_DIM) {
    const bigger = width >= height ? 'width' : 'height';
    const dim    = Math.max(width, height);
    return {
      ok: false,
      width,
      height,
      maxScale,
      reason:
        `Export ${bigger} ${dim}px exceeds browser canvas limit (${MAX_CANVAS_DIM}px). ` +
        `Try scale ≤ ×${maxScale} for this document (${docW}×${docH}), or export as SVG for unlimited resolution.`,
    };
  }

  return { ok: true, width, height, maxScale, reason: '' };
}
