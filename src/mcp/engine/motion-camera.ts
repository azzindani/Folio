/**
 * Camera framing — the pose that fills the canvas with a target, written as
 * ordinary scale / x / y channels on a full-canvas group.
 *
 * The camera group's box IS the canvas (a transparent full-canvas rect pins its
 * fill-box), so it pivots on the canvas centre. A shot scales by s about that
 * centre, then translates the target's centre onto it:
 *   p' = centre + (x, y) + s · (p − centre)
 * which is the composition both players already use — keyframe-css's
 * `translate() scale()` with a transform-origin, and frame-pose's
 * `translate(offset) translate(pivot) scale translate(-pivot)`.
 */

export interface Box { x: number; y: number; width: number; height: number }
export interface CameraPose { scale: number; x: number; y: number }

/** Fill the canvas with `target`, keeping `padding` px of it clear on the tighter axis. */
export function framePose(target: Box, canvas: { width: number; height: number }, padding = 0): CameraPose {
  const w = Math.max(1, target.width + padding * 2);
  const h = Math.max(1, target.height + padding * 2);
  const s = Math.min(canvas.width / w, canvas.height / h);
  const dx = target.x + target.width / 2 - canvas.width / 2;
  const dy = target.y + target.height / 2 - canvas.height / 2;
  // `|| 0` turns a -0 (framing the whole canvas) into a plain 0 in the written track.
  const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;
  return { scale: Number(s.toFixed(4)), x: r2(-s * dx), y: r2(-s * dy) };
}
