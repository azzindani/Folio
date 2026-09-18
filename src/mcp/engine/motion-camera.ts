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

/**
 * Fill the canvas with `target`, keeping `padding` px of it clear on the tighter axis.
 *
 * `pivot` is the centre of the camera group's box — the canvas centre unless a
 * world larger than the canvas pins it (op:camera world). A shot must put the
 * target's centre on the canvas centre C: C = P + T + s·(c − P), so
 * T = C − P − s·(c − P). With P = C that is the familiar −s·(c − C).
 */
export function framePose(target: Box, canvas: { width: number; height: number }, padding = 0, pivot?: { x: number; y: number }): CameraPose {
  const w = Math.max(1, target.width + padding * 2);
  const h = Math.max(1, target.height + padding * 2);
  const s = Math.min(canvas.width / w, canvas.height / h);
  const P = pivot ?? { x: canvas.width / 2, y: canvas.height / 2 };
  const cx = target.x + target.width / 2, cy = target.y + target.height / 2;
  // `|| 0` turns a -0 (framing the whole canvas) into a plain 0 in the written track.
  const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;
  return { scale: Number(s.toFixed(4)), x: r2(canvas.width / 2 - P.x - s * (cx - P.x)), y: r2(canvas.height / 2 - P.y - s * (cy - P.y)) };
}
